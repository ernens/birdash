"""BirdEngine — Heuristic bounding-box computation for live detections.

Phase 1C of Detection Refinement: at clip-extraction time, compute a
time-frequency bbox from the just-written MP3 and INSERT into
detection_bbox_v1. Mirrors the offline backfill logic verbatim
(scripts/refinement/backfill_bbox.py) so live and historical bboxes
share algorithm_version='heuristic_v1' — no schema branches downstream.

Runs in the post-process daemon thread, so a slow ffmpeg decode or a
brief writer-lock contention never blocks the inference loop.
"""

import csv
import logging
import os
import sqlite3
import subprocess
import time
from pathlib import Path

import numpy as np
import scipy.ndimage
import scipy.signal

log = logging.getLogger("birdengine")

# Mirror backfill_bbox.py exactly — bumping the algorithm requires bumping
# the version string in BOTH places, then re-backfilling, so they don't
# diverge silently.
ALGORITHM_VERSION = "heuristic_v1_1"

# Drop bboxes whose peak-to-mean ratio is below this — empirically these are
# noise on uniformly-bruited clips (Phase 0 case 0045: SNR=1.6 produced a
# 3.4 s bbox eating most of the clip, no real signal under it).
MIN_SNR = 2.0

# Drop bboxes that are both very short AND truncated against a clip edge
# (Phase 0 case 0120: 0.15 s bbox starting at 0.03 s — boundary artifact).
MIN_TRUNCATED_DURATION_S = 0.3

from db import resolve_db_path
DB_PATH = resolve_db_path()
# Sibling-relative — the CSV ships with the repo under config/, regardless of
# which user runs the engine.
TAXONOMY_CSV = Path(__file__).parent.parent / "config" / "ebird-taxonomy.csv"

# Per-family overrides for taxa whose ORDER fallback band misses their actual
# vocal range. Looked up before ORDER_BANDS. Keep additions narrow — only add
# when Phase 0/1.5 evaluation shows the order band is wrong for the family.
FAMILY_BANDS = {
    # Corvids (crows, jays, magpies) are Passeriformes but vocalize 200-3000 Hz,
    # well below the 1000-8000 Hz Passeriformes default (Phase 0 cases 0078, 0120).
    "Corvidae": (200, 3000),
}

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

_taxo_cache = None


def _load_taxonomy():
    """Returns {sci_name: (order, family)} cached after first call."""
    global _taxo_cache
    if _taxo_cache is not None:
        return _taxo_cache
    sci_to_taxo = {}
    if not TAXONOMY_CSV.exists():
        log.warning("[bbox] taxonomy not found at %s — falling back to default band", TAXONOMY_CSV)
        _taxo_cache = sci_to_taxo
        return sci_to_taxo
    with TAXONOMY_CSV.open() as f:
        header = f.readline().rstrip("\n").split(",")
        sci_idx = header.index("SCIENTIFIC_NAME")
        order_idx = header.index("ORDER")
        family_idx = header.index("FAMILY_SCI_NAME")
        for row in csv.reader(f):
            if len(row) > max(sci_idx, order_idx, family_idx):
                sci_to_taxo[row[sci_idx]] = (row[order_idx], row[family_idx])
    _taxo_cache = sci_to_taxo
    return sci_to_taxo


def _band_for_species(sci_name):
    order, family = _load_taxonomy().get(sci_name, ("", ""))
    if family in FAMILY_BANDS:
        return FAMILY_BANDS[family]
    return ORDER_BANDS.get(order, DEFAULT_BAND)


def _heuristic_bbox(audio, sr, fmin, fmax, nperseg=2048, noverlap=1536):
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


def _decode_audio(mp3_path, target_sr=32000):
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(mp3_path),
        "-ac", "1", "-ar", str(target_sr), "-f", "f32le", "-",
    ]
    p = subprocess.run(cmd, capture_output=True, check=True, timeout=30)
    return np.frombuffer(p.stdout, dtype=np.float32).copy(), target_sr


# UPSERT on file_name PK — replaces any prior row regardless of its
# algorithm_version. This is what lets a backfill at a new version overwrite
# stale rows in place instead of leaving two algorithms living side-by-side.
_INSERT_SQL = """
    INSERT INTO detection_bbox_v1
      (file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
       peak_t_s, peak_energy, snr_estimate, truncated,
       algorithm_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_name) DO UPDATE SET
      t_min_s = excluded.t_min_s,
      t_max_s = excluded.t_max_s,
      f_min_hz = excluded.f_min_hz,
      f_max_hz = excluded.f_max_hz,
      peak_t_s = excluded.peak_t_s,
      peak_energy = excluded.peak_energy,
      snr_estimate = excluded.snr_estimate,
      truncated = excluded.truncated,
      algorithm_version = excluded.algorithm_version,
      created_at = excluded.created_at
"""


def compute_and_write_bbox(mp3_path, sci_name, file_name):
    """Compute bbox from an extracted MP3 clip and INSERT into detection_bbox_v1.

    Returns True on insert, False on skip (no clip / no peak / decode error /
    table missing). All errors are swallowed and logged at warning level — a
    bbox failure must never poison the post-processing pipeline.
    """
    try:
        if not os.path.exists(mp3_path) or os.path.getsize(mp3_path) == 0:
            return False
        try:
            audio, sr = _decode_audio(mp3_path)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            log.warning("[bbox] decode failed for %s: %s", file_name, e)
            return False
        fmin, fmax = _band_for_species(sci_name)
        bbox = _heuristic_bbox(audio, sr, fmin, fmax)
        if bbox is None:
            return False
        if bbox["snr_estimate"] < MIN_SNR:
            return False
        if bbox["truncated"] and (bbox["t_max_s"] - bbox["t_min_s"]) < MIN_TRUNCATED_DURATION_S:
            return False
        conn = sqlite3.connect(DB_PATH, timeout=30)
        try:
            conn.execute("PRAGMA busy_timeout = 30000")
            with conn:
                conn.execute(_INSERT_SQL, (
                    file_name,
                    bbox["t_min_s"], bbox["t_max_s"],
                    bbox["f_min_hz"], bbox["f_max_hz"],
                    bbox["peak_t_s"], bbox["peak_energy"],
                    bbox["snr_estimate"], bbox["truncated"],
                    ALGORITHM_VERSION, int(time.time()),
                ))
        finally:
            conn.close()
        return True
    except Exception as e:
        log.warning("[bbox] unexpected error for %s: %s", file_name, e)
        return False
