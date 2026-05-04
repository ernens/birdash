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
ALGORITHM_VERSION = "heuristic_v1"

DB_PATH = "/home/bjorn/BirdNET-Pi/scripts/birds.db"
TAXONOMY_CSV = Path("/home/bjorn/birdash/config/ebird-taxonomy.csv")

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
    global _taxo_cache
    if _taxo_cache is not None:
        return _taxo_cache
    sci_to_order = {}
    if not TAXONOMY_CSV.exists():
        log.warning("[bbox] taxonomy not found at %s — falling back to default band", TAXONOMY_CSV)
        _taxo_cache = sci_to_order
        return sci_to_order
    with TAXONOMY_CSV.open() as f:
        header = f.readline().rstrip("\n").split(",")
        sci_idx = header.index("SCIENTIFIC_NAME")
        order_idx = header.index("ORDER")
        for row in csv.reader(f):
            if len(row) > max(sci_idx, order_idx):
                sci_to_order[row[sci_idx]] = row[order_idx]
    _taxo_cache = sci_to_order
    return sci_to_order


def _band_for_species(sci_name):
    order = _load_taxonomy().get(sci_name, "")
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


_INSERT_SQL = """
    INSERT OR IGNORE INTO detection_bbox_v1
      (file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
       peak_t_s, peak_energy, snr_estimate, truncated,
       algorithm_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
