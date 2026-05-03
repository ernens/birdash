#!/usr/bin/env python3
"""
Phase 1A — Backfill : calcule le bbox heuristique pour les détections
historiques et l'écrit dans `detection_bbox_v1`.

Idempotent : INSERT OR IGNORE sur file_name (PK). Reprenable : --resume
saute les détections déjà raffinées à la même algorithm_version.

Sécurité :
- Décode l'audio via ffmpeg en sous-processus (pas d'import du moteur)
- Tourne en `nice -n 19 ionice -c 3` pour ne pas concurrencer le pipeline
- Commit toutes les BATCH_SIZE détections pour borner la durée des
  transactions (évite de tenir le lock writer trop longtemps)
- Vérifie si l'engine est actif (sentinelle /tmp/birdengine-active si
  présente) et attend en cas d'activité — soft check, pas bloquant

Usage :
    nice -n 19 ionice -c 3 \\
        /home/bjorn/birdengine/venv/bin/python3 \\
        scripts/refinement/backfill_bbox.py \\
        [--limit N] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
"""

import argparse
import csv
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import scipy.ndimage
import scipy.signal

# ── Chemins ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = "/home/bjorn/BirdNET-Pi/scripts/birds.db"
CLIPS_ROOT = Path("/home/bjorn/BirdSongs/Extracted/By_Date")
TAXONOMY_CSV = PROJECT_ROOT / "config" / "ebird-taxonomy.csv"

ALGORITHM_VERSION = "heuristic_v1"
BATCH_SIZE = 50  # commit toutes les N insertions

# ── Bandes fréquentielles fallback (SPEC §3.5) ─────────────────────────────
ORDER_BANDS = {
    "Passeriformes":     (1000, 8000),
    "Falconiformes":     (500,  3500),
    "Accipitriformes":   (500,  3500),
    "Strigiformes":      (200,  2500),
    "Anseriformes":      (200,  3000),
    "Pelecaniformes":    (200,  3000),
    "Galliformes":       (300,  4000),
    "Piciformes":        (800,  5000),
    "Columbiformes":     (200,  1500),
    "Charadriiformes":   (1000, 6000),
    "Apodiformes":       (4000, 9000),
}
DEFAULT_BAND = (500, 10000)


def heuristic_bbox(audio, sr, fmin, fmax, nperseg=2048, noverlap=1536):
    f, t, S = scipy.signal.spectrogram(
        audio, fs=sr, nperseg=nperseg, noverlap=noverlap, scaling="spectrum"
    )
    band_mask = (f >= fmin) & (f <= fmax)
    if not band_mask.any():
        return None
    S_band = S[band_mask, :]
    energy = S_band.sum(axis=0)
    energy_smooth = scipy.ndimage.gaussian_filter1d(energy, sigma=2.0)

    threshold = energy_smooth.mean() + 1.5 * energy_smooth.std()
    peaks, _ = scipy.signal.find_peaks(energy_smooth, height=threshold)
    if len(peaks) == 0:
        return None
    peak_idx = peaks[np.argmax(energy_smooth[peaks])]
    peak_value = float(energy_smooth[peak_idx])

    half = peak_value / 2
    left = peak_idx
    while left > 0 and energy_smooth[left] > half:
        left -= 1
    right = peak_idx
    while right < len(energy_smooth) - 1 and energy_smooth[right] > half:
        right += 1

    truncated = (left == 0) or (right == len(energy_smooth) - 1)

    return {
        "t_min_s": float(t[left]),
        "t_max_s": float(t[right]),
        "f_min_hz": float(fmin),
        "f_max_hz": float(fmax),
        "peak_t_s": float(t[peak_idx]),
        "peak_energy": peak_value,
        "snr_estimate": float(peak_value / energy_smooth.mean()),
        "truncated": 1 if truncated else 0,
    }


def decode_audio(mp3_path, target_sr=32000):
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(mp3_path),
        "-ac", "1", "-ar", str(target_sr), "-f", "f32le", "-",
    ]
    p = subprocess.run(cmd, capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy(), target_sr


def load_taxonomy():
    sci_to_order = {}
    if not TAXONOMY_CSV.exists():
        return sci_to_order
    with TAXONOMY_CSV.open() as f:
        header = f.readline().rstrip("\n").split(",")
        sci_idx = header.index("SCIENTIFIC_NAME")
        order_idx = header.index("ORDER")
        for row in csv.reader(f):
            if len(row) > max(sci_idx, order_idx):
                sci_to_order[row[sci_idx]] = row[order_idx]
    return sci_to_order


def band_for_species(sci_name, taxo):
    order = taxo.get(sci_name, "")
    return ORDER_BANDS.get(order, DEFAULT_BAND)


def clip_path(date, com_name, file_name):
    return CLIPS_ROOT / date / com_name.replace(" ", "_") / file_name


def wait_if_engine_busy(max_wait_s=5.0):
    """Soft check : si la sentinelle existe et est récente, attendre.
    L'engine ne crée pas cette sentinelle aujourd'hui — c'est juste un
    hook prêt pour quand le moteur l'écrira (SPEC §5.8.2)."""
    sentinel = Path("/tmp/birdengine-active")
    if not sentinel.exists():
        return
    age = time.time() - sentinel.stat().st_mtime
    if age < 5.0:
        time.sleep(min(max_wait_s, 5.0 - age))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None,
                    help="Nombre max de détections à traiter (défaut : tout)")
    ap.add_argument("--from", dest="date_from", default=None,
                    help="Date de début (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", default=None,
                    help="Date de fin (YYYY-MM-DD)")
    ap.add_argument("--dry-run", action="store_true",
                    help="N'écrit rien, affiche juste ce qui serait traité")
    args = ap.parse_args()

    print(f"[backfill] DB: {DB_PATH}")
    print(f"[backfill] algorithm_version: {ALGORITHM_VERSION}")

    taxo = load_taxonomy()
    print(f"[backfill] Taxonomie eBird : {len(taxo)} espèces")

    # Lecture des détections candidates (LEFT JOIN pour exclure celles déjà
    # raffinées à cette version, plus simple qu'un EXCEPT subquery)
    where = ["b.file_name IS NULL"]
    params = []
    if args.date_from:
        where.append("d.Date >= ?")
        params.append(args.date_from)
    if args.date_to:
        where.append("d.Date <= ?")
        params.append(args.date_to)

    sql = f"""
        SELECT d.Date, d.Time, d.Sci_Name, d.Com_Name, d.File_Name
        FROM detections d
        LEFT JOIN detection_bbox_v1 b
          ON b.file_name = d.File_Name
         AND b.algorithm_version = '{ALGORITHM_VERSION}'
        WHERE {' AND '.join(where)}
        ORDER BY d.Date DESC, d.Time DESC
    """
    if args.limit:
        sql += f" LIMIT {int(args.limit)}"

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    rows = conn.execute(sql, params).fetchall()
    print(f"[backfill] À traiter : {len(rows)} détections")

    if args.dry_run:
        print("[backfill] DRY-RUN — rien n'est écrit.")
        for date, time_s, sci, com, fname in rows[:5]:
            print(f"  {date} {time_s} {com} ({sci}) — {fname}")
        if len(rows) > 5:
            print(f"  ... et {len(rows)-5} autres")
        conn.close()
        return

    inserted = no_clip = no_bbox = decode_err = 0
    insert_buf = []
    t0 = time.perf_counter()

    INSERT_SQL = """
        INSERT OR IGNORE INTO detection_bbox_v1
          (file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
           peak_t_s, peak_energy, snr_estimate, truncated,
           algorithm_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    def flush():
        nonlocal insert_buf, inserted
        if not insert_buf:
            return
        wait_if_engine_busy()
        with conn:
            conn.executemany(INSERT_SQL, insert_buf)
        inserted += len(insert_buf)
        insert_buf = []

    for i, (date, time_s, sci, com, fname) in enumerate(rows, 1):
        clip = clip_path(date, com, fname)
        if not clip.exists():
            no_clip += 1
            continue
        try:
            audio, sr = decode_audio(clip)
        except subprocess.CalledProcessError:
            decode_err += 1
            continue
        fmin, fmax = band_for_species(sci, taxo)
        bbox = heuristic_bbox(audio, sr, fmin, fmax)
        if bbox is None:
            no_bbox += 1
            continue
        insert_buf.append((
            fname,
            bbox["t_min_s"], bbox["t_max_s"],
            bbox["f_min_hz"], bbox["f_max_hz"],
            bbox["peak_t_s"], bbox["peak_energy"],
            bbox["snr_estimate"], bbox["truncated"],
            ALGORITHM_VERSION, int(time.time()),
        ))
        if len(insert_buf) >= BATCH_SIZE:
            flush()

        if i % 100 == 0:
            elapsed = time.perf_counter() - t0
            rate = i / elapsed
            eta_s = (len(rows) - i) / rate
            print(f"  [{i}/{len(rows)}] {elapsed:.0f}s — "
                  f"insérés {inserted}, sans-clip {no_clip}, sans-bbox {no_bbox}, "
                  f"erreurs {decode_err} — {rate:.1f} det/s, ETA {eta_s/60:.1f} min")

    flush()
    conn.close()

    elapsed = time.perf_counter() - t0
    print(f"\n[backfill] Terminé en {elapsed:.0f}s")
    print(f"[backfill] Insérés : {inserted}")
    print(f"[backfill] Sans clip (purgés) : {no_clip}")
    print(f"[backfill] Sans bbox (énergie uniforme) : {no_bbox}")
    print(f"[backfill] Erreurs décodage : {decode_err}")


if __name__ == "__main__":
    sys.exit(main())
