#!/usr/bin/env python3
"""
Phase 0 — Validation empirique de l'heuristique bbox (SPEC §8 Phase 0).

NE TOUCHE PAS au pipeline live. Lit seulement birds.db (ouverture
read-only via URI ?mode=ro), décode les MP3 déjà extraits, et écrit
sa sortie dans docs/refinement/phase0/. Aucun import du moteur,
aucun chargement de modèle ML, aucune écriture en DB.

Usage :
    nice -n 19 ionice -c 3 \
        /home/bjorn/birdengine/venv/bin/python3 \
        scripts/refinement/phase0_eval.py [--n 150] [--seed 42]

Sortie : docs/refinement/phase0/index.html (galerie annotable, les
annotations sont stockées en localStorage du navigateur et exportables
en JSON via le bouton "Export annotations").
"""

import argparse
import base64
import datetime
import io
import json
import os
import random
import sqlite3
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

import numpy as np
import scipy.ndimage
import scipy.signal

# ── Chemins (lecture seule pour les sources) ───────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = "/home/bjorn/BirdNET-Pi/scripts/birds.db"
CLIPS_ROOT = Path("/home/bjorn/BirdSongs/Extracted/By_Date")
TAXONOMY_CSV = PROJECT_ROOT / "config" / "ebird-taxonomy.csv"
OUT_DIR = PROJECT_ROOT / "docs" / "refinement" / "phase0"

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


# ── Heuristique bbox (SPEC §3.2, copie verbatim hors stockage) ─────────────
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
        "truncated": truncated,
    }


# ── Spectrogramme PNG en mémoire (sans matplotlib pyplot global) ───────────
def render_spectrogram_png(audio, sr, bbox=None, max_hz=12000, dpi=70):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    f, t, S = scipy.signal.spectrogram(
        audio, fs=sr, nperseg=2048, noverlap=1536, scaling="spectrum"
    )
    S_db = 10 * np.log10(np.maximum(S, 1e-12))
    keep = f <= max_hz
    f, S_db = f[keep], S_db[keep, :]

    fig, ax = plt.subplots(figsize=(8, 3), dpi=dpi)
    ax.pcolormesh(t, f / 1000, S_db, shading="auto", cmap="magma",
                  vmin=np.percentile(S_db, 5), vmax=np.percentile(S_db, 99))
    ax.set_xlabel("t (s)")
    ax.set_ylabel("kHz")
    ax.set_xlim(0, t[-1])
    ax.set_ylim(0, max_hz / 1000)

    if bbox:
        from matplotlib.patches import Rectangle
        rect = Rectangle(
            (bbox["t_min_s"], bbox["f_min_hz"] / 1000),
            bbox["t_max_s"] - bbox["t_min_s"],
            (bbox["f_max_hz"] - bbox["f_min_hz"]) / 1000,
            edgecolor="cyan", facecolor="none", linewidth=2,
            linestyle="--" if bbox.get("truncated") else "-",
        )
        ax.add_patch(rect)
        ax.axvline(bbox["peak_t_s"], color="cyan", alpha=0.4, linewidth=1)

    fig.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


# ── Décodage MP3 → mono PCM via ffmpeg (pas de dépendance Python) ──────────
def decode_audio(mp3_path, target_sr=32000):
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(mp3_path),
        "-ac", "1", "-ar", str(target_sr), "-f", "f32le", "-",
    ]
    p = subprocess.run(cmd, capture_output=True, check=True)
    pcm = np.frombuffer(p.stdout, dtype=np.float32).copy()
    return pcm, target_sr


# ── Lookup ordre taxonomique via ebird-taxonomy.csv ────────────────────────
def load_taxonomy():
    sci_to_order = {}
    with TAXONOMY_CSV.open() as f:
        header = f.readline().rstrip("\n").split(",")
        sci_idx = header.index("SCIENTIFIC_NAME")
        order_idx = header.index("ORDER")
        import csv
        for row in csv.reader(f):
            if len(row) > max(sci_idx, order_idx):
                sci_to_order[row[sci_idx]] = row[order_idx]
    return sci_to_order


def band_for_species(sci_name, taxo):
    order = taxo.get(sci_name, "")
    return ORDER_BANDS.get(order, DEFAULT_BAND), order


# ── DB : ouverture stricte read-only ───────────────────────────────────────
def open_db_ro(path):
    uri = "file:" + urllib.parse.quote(path) + "?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def sample_detections(conn, n, seed):
    """Tire n détections aléatoires (mais reproductibles) sur les 30 derniers
    jours. Évite les très anciens fichiers déjà purgés."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT Date, Time, Sci_Name, Com_Name, Confidence, File_Name, Model
        FROM detections
        WHERE Date >= date('now', '-30 day')
        ORDER BY Date, Time
        """
    )
    rows = cur.fetchall()
    rng = random.Random(seed)
    rng.shuffle(rows)
    return rows[:n]


def clip_path(date, com_name, file_name):
    species_dir = com_name.replace(" ", "_")
    return CLIPS_ROOT / date / species_dir / file_name


# ── Génération de la galerie HTML ──────────────────────────────────────────
HTML_HEAD = """<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<title>Phase 0 — Annotation bbox heuristique</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0e1116; color:#e7eaf0; font-family:system-ui,sans-serif;
         margin:0; padding:1rem 2rem 4rem; }
  h1 { margin-top:.2rem; }
  .summary { font-size:.85rem; color:#aab; margin-bottom:1rem; }
  .legend { font-size:.78rem; color:#aab; margin-bottom:1rem; line-height:1.6; }
  .legend code { background:#1c2330; padding:.05rem .3rem; border-radius:3px; }
  .toolbar { position:sticky; top:0; background:#0e1116; padding:.6rem 0;
             border-bottom:1px solid #2a3340; z-index:10;
             display:flex; gap:1rem; align-items:center; flex-wrap:wrap; }
  .toolbar button { background:#26344a; color:#fff; border:1px solid #3a4a64;
                    padding:.35rem .7rem; border-radius:4px; cursor:pointer; }
  .toolbar button:hover { background:#324460; }
  .stats { font-family:monospace; font-size:.85rem; }
  .stats span { margin-right:1rem; }
  .item { display:grid; grid-template-columns: 380px 1fr; gap:1rem;
          padding:1rem 0; border-bottom:1px solid #1c2330; align-items:start; }
  .item img { max-width:100%; border-radius:4px; background:#000; }
  .meta { font-size:.85rem; line-height:1.5; }
  .meta b { color:#9ec5ff; }
  .meta .sci { font-style:italic; color:#aab; }
  .annot { margin-top:.5rem; }
  .annot label { display:inline-block; margin-right:1rem; cursor:pointer;
                 padding:.15rem .5rem; border-radius:3px; }
  .annot label:hover { background:#1c2330; }
  .annot input[type=radio] { margin-right:.3rem; }
  .annot label.useful   { color:#7fd17f; }
  .annot label.medium   { color:#e6c869; }
  .annot label.useless  { color:#999; }
  .annot label.misleading { color:#ff7474; }
  .nobbox { color:#888; font-style:italic; }
</style>
</head><body>
<h1>Phase 0 — Annotation bbox heuristique</h1>
<div class="summary">SAMPLE_DETAILS</div>
<div class="legend">
  Pour chaque détection, le bbox cyan est calculé par
  <code>heuristic_bbox()</code>. Trait plein = pic clair, trait pointillé = pic
  en bord de fenêtre (tronqué). Annote chacune ; tout est sauvegardé en
  <code>localStorage</code>. Bouton <b>Export annotations</b> en haut pour
  récupérer un JSON.<br>
  <b>Catégories</b> :
  <span style="color:#7fd17f">utile</span> = bbox englobe la vocalise ·
  <span style="color:#e6c869">moyen</span> = imprécis mais aide à localiser ·
  <span style="color:#999">inutile</span> = positionné aléatoirement ·
  <span style="color:#ff7474">trompeur</span> = pointe vers une zone non liée à l'espèce.
  <br>Critères go-Phase 1 : ≥ 70 % utile, ≤ 5 % trompeur.
</div>
<div class="toolbar">
  <div class="stats" id="stats"></div>
  <button onclick="exportAnnotations()">Export annotations (JSON)</button>
  <button onclick="if(confirm('Effacer toutes les annotations ?')) { localStorage.removeItem(KEY); location.reload(); }">Reset</button>
</div>
"""

HTML_TAIL = """
<script>
const KEY = 'phase0_annotations_v1';
const annots = JSON.parse(localStorage.getItem(KEY) || '{}');

function save() {
  localStorage.setItem(KEY, JSON.stringify(annots));
  updateStats();
}

document.addEventListener('change', (e) => {
  if (e.target.matches('input[type=radio][data-id]')) {
    annots[e.target.dataset.id] = e.target.value;
    save();
  }
});

function updateStats() {
  const counts = { useful:0, medium:0, useless:0, misleading:0 };
  for (const v of Object.values(annots)) if (counts[v] != null) counts[v]++;
  const total = document.querySelectorAll('.item').length;
  const done = Object.keys(annots).length;
  const pct = (k) => total ? (100 * counts[k] / total).toFixed(1) + '%' : '—';
  document.getElementById('stats').innerHTML =
    `<span>annoté ${done}/${total}</span>` +
    `<span style="color:#7fd17f">utile ${counts.useful} (${pct('useful')})</span>` +
    `<span style="color:#e6c869">moyen ${counts.medium} (${pct('medium')})</span>` +
    `<span style="color:#999">inutile ${counts.useless} (${pct('useless')})</span>` +
    `<span style="color:#ff7474">trompeur ${counts.misleading} (${pct('misleading')})</span>`;
}

function exportAnnotations() {
  const blob = new Blob([JSON.stringify(annots, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'phase0_annotations.json';
  a.click();
}

// Restore prior selections
for (const [id, val] of Object.entries(annots)) {
  const el = document.querySelector(`input[type=radio][data-id="${id}"][value="${val}"]`);
  if (el) el.checked = true;
}
updateStats();
</script>
</body></html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150,
                    help="Nombre de détections à échantillonner (défaut 150)")
    ap.add_argument("--seed", type=int, default=42,
                    help="Seed RNG pour reproductibilité")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[phase0] DB: {DB_PATH} (read-only)")
    print(f"[phase0] Sortie: {OUT_DIR}")

    taxo = load_taxonomy()
    print(f"[phase0] Taxonomie eBird chargée: {len(taxo)} espèces")

    conn = open_db_ro(DB_PATH)
    sample = sample_detections(conn, args.n, args.seed)
    conn.close()
    print(f"[phase0] Échantillon: {len(sample)} détections")

    items_html = []
    n_ok = n_no_clip = n_no_bbox = n_decode_err = 0
    latencies_ms = []
    snrs = []
    band_counts = {}

    t0_total = time.perf_counter()
    for i, (date, time_s, sci, com, conf, fname, model) in enumerate(sample, 1):
        clip = clip_path(date, com, fname)
        if not clip.exists():
            n_no_clip += 1
            continue
        try:
            audio, sr = decode_audio(clip)
        except subprocess.CalledProcessError as e:
            n_decode_err += 1
            continue

        (fmin, fmax), order = band_for_species(sci, taxo)
        band_counts[order or "(unknown)"] = band_counts.get(order or "(unknown)", 0) + 1

        t0 = time.perf_counter()
        bbox = heuristic_bbox(audio, sr, fmin, fmax)
        latencies_ms.append((time.perf_counter() - t0) * 1000)
        if bbox is None:
            n_no_bbox += 1

        png_bytes = render_spectrogram_png(audio, sr, bbox=bbox)
        b64 = base64.b64encode(png_bytes).decode("ascii")

        det_id = f"{date}_{time_s.replace(':', '')}_{i:04d}"
        if bbox:
            snrs.append(bbox["snr_estimate"])
            bbox_info = (
                f"bbox: t [{bbox['t_min_s']:.2f}s → {bbox['t_max_s']:.2f}s], "
                f"f [{bbox['f_min_hz']:.0f} → {bbox['f_max_hz']:.0f} Hz], "
                f"SNR {bbox['snr_estimate']:.1f}"
                + (" <span style='color:#e6c869'>(tronqué)</span>" if bbox.get("truncated") else "")
            )
        else:
            bbox_info = '<span class="nobbox">— pas de pic clair détecté —</span>'

        items_html.append(f"""
<div class="item">
  <div><img src="data:image/png;base64,{b64}" alt="spectro"></div>
  <div class="meta">
    <b>{com}</b> <span class="sci">({sci})</span> · ordre <b>{order or "?"}</b><br>
    {date} {time_s} · conf <b>{conf:.3f}</b> · modèle <code>{model}</code><br>
    bande utilisée: <b>{fmin:.0f}-{fmax:.0f} Hz</b><br>
    {bbox_info}<br>
    fichier: <code style="font-size:.7rem">{fname}</code>
    <div class="annot">
      <label class="useful"><input type="radio" name="a_{det_id}" data-id="{det_id}" value="useful">utile</label>
      <label class="medium"><input type="radio" name="a_{det_id}" data-id="{det_id}" value="medium">moyen</label>
      <label class="useless"><input type="radio" name="a_{det_id}" data-id="{det_id}" value="useless">inutile</label>
      <label class="misleading"><input type="radio" name="a_{det_id}" data-id="{det_id}" value="misleading">trompeur</label>
    </div>
  </div>
</div>
""")
        n_ok += 1
        if i % 10 == 0:
            elapsed = time.perf_counter() - t0_total
            print(f"  [{i}/{len(sample)}] {elapsed:.0f}s — ok={n_ok}, sans-clip={n_no_clip}, sans-bbox={n_no_bbox}")

    elapsed = time.perf_counter() - t0_total
    summary = (
        f"Généré {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} · "
        f"{n_ok} clips traités en {elapsed:.0f}s · "
        f"sans-clip {n_no_clip} · sans-bbox {n_no_bbox} · décode-err {n_decode_err} · "
        f"latence bbox moy {np.mean(latencies_ms):.1f} ms (p95 {np.percentile(latencies_ms, 95):.1f}) · "
        f"SNR médian {np.median(snrs) if snrs else 0:.1f}"
    )
    print("\n[phase0] " + summary)
    print("[phase0] Bandes utilisées par ordre :",
          ", ".join(f"{k}={v}" for k, v in sorted(band_counts.items(), key=lambda x: -x[1])))

    html = HTML_HEAD.replace("SAMPLE_DETAILS", summary) + "".join(items_html) + HTML_TAIL
    out_html = OUT_DIR / "index.html"
    out_html.write_text(html, encoding="utf-8")

    # Aussi un petit JSON de métriques pour traçabilité
    metrics = {
        "generated_at": datetime.datetime.now().isoformat(),
        "n_sampled": len(sample),
        "n_ok": n_ok,
        "n_no_clip": n_no_clip,
        "n_no_bbox": n_no_bbox,
        "n_decode_err": n_decode_err,
        "elapsed_s": round(elapsed, 1),
        "latency_bbox_ms": {
            "mean": round(float(np.mean(latencies_ms)), 2) if latencies_ms else None,
            "p50": round(float(np.percentile(latencies_ms, 50)), 2) if latencies_ms else None,
            "p95": round(float(np.percentile(latencies_ms, 95)), 2) if latencies_ms else None,
            "max": round(float(np.max(latencies_ms)), 2) if latencies_ms else None,
        },
        "snr_estimate": {
            "median": round(float(np.median(snrs)), 2) if snrs else None,
            "p10":    round(float(np.percentile(snrs, 10)), 2) if snrs else None,
            "p90":    round(float(np.percentile(snrs, 90)), 2) if snrs else None,
        },
        "bands_used_per_order": dict(sorted(band_counts.items(), key=lambda x: -x[1])),
        "seed": args.seed,
    }
    (OUT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(f"\n[phase0] HTML : {out_html}")
    print(f"[phase0] Ouvre dans le navigateur, annote, puis 'Export annotations'.")


if __name__ == "__main__":
    sys.exit(main())
