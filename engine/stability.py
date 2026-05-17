"""BirdEngine — Stability check worker (Phase 2).

Pulls candidate detections from `stability_queue`, recenters a 5 s
window on the bbox peak from `detection_bbox_v1`, re-runs Perch on that
window, and writes the ratio-to-original confidence to
`detection_stability_v1`.

Runs as its own systemd service (`birdengine-stability.service`),
disabled by default. Loads its own Perch instance — independent of the
main engine to keep restart blast radius small.

CLI :
    python stability.py              # daemon, polls queue every 30 s
    python stability.py --once FILE  # single check, prints result, no DB write
"""

import argparse
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

# Engine modules — loaded lazily in main() so --once tests don't trigger
# the heavy TFLite import path on every help/syntax-check.
log = logging.getLogger("birdengine-stability")

from db import resolve_db_path
DB_PATH = resolve_db_path()
CLIPS_ROOT = Path("/home/bjorn/BirdSongs/Extracted/By_Date")

ALGORITHM_VERSION = "stability_v1"

# Defaults — overridable via config.toml [stability_check] section
DEFAULT_POLL_INTERVAL_S = 30
DEFAULT_ENGINE_QUIESCENT_S = 5.0
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RATIO_STABLE = 0.8     # ratio >= 0.8 → stable
DEFAULT_RATIO_UNSTABLE = 0.5   # ratio < 0.5 → unstable
DEFAULT_CONFIDENCE_THRESHOLD = 0.6  # only enqueue detections below this

PERCH_SR = 32000
PERCH_WINDOW_S = 5
PERCH_WINDOW_SAMPLES = PERCH_SR * PERCH_WINDOW_S  # 160_000


# ── Producer-side enqueue (called from the live engine) ──────────────────

_producer_cache = None


def _producer_settings():
    """Lazy-load (enabled, threshold) from engine config.toml. Cached.

    Default: disabled — Phase 2 is opt-in. The worker side is also gated
    by systemctl enable, but having the producer also no-op when disabled
    keeps the queue from filling up on installs that never opt in.
    """
    global _producer_cache
    if _producer_cache is not None:
        return _producer_cache
    cfg_path = "/home/bjorn/birdengine/config.toml"
    enabled = False
    threshold = DEFAULT_CONFIDENCE_THRESHOLD
    try:
        import toml
        with open(cfg_path) as f:
            cfg = toml.load(f)
        sc = cfg.get("stability_check", {})
        enabled = bool(sc.get("enabled", False))
        threshold = float(sc.get("confidence_threshold", DEFAULT_CONFIDENCE_THRESHOLD))
    except Exception:
        pass
    _producer_cache = (enabled, threshold)
    return _producer_cache


def enqueue_for_check(file_name, confidence):
    """Best-effort INSERT into stability_queue.

    Returns True if enqueued, False if disabled / above threshold / on
    error. Silently swallows DB errors at warning level — a queue insert
    failure must never poison the inference pipeline.
    """
    enabled, threshold = _producer_settings()
    if not enabled:
        return False
    if confidence >= threshold:
        return False
    try:
        conn = sqlite3.connect(DB_PATH, timeout=60)
        conn.execute("PRAGMA busy_timeout = 60000")
        conn.execute("PRAGMA journal_size_limit = 67108864")
        try:
            with conn:
                conn.execute(
                    "INSERT OR IGNORE INTO stability_queue (file_name, enqueued_at) "
                    "VALUES (?, ?)", (file_name, int(time.time())))
        finally:
            conn.close()
        return True
    except Exception as e:
        log.warning("[stability] enqueue failed for %s: %s", file_name, e)
        return False


# ── DB helpers ─────────────────────────────────────────────────────────────

def _open_db():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_size_limit = 67108864")
    return conn


def _peek_next(conn):
    """Pop oldest queued file_name. Returns (file_name, attempts) or None."""
    row = conn.execute(
        "SELECT file_name, attempts FROM stability_queue "
        "ORDER BY enqueued_at ASC LIMIT 1"
    ).fetchone()
    return row


def _bump_attempts(conn, file_name):
    with conn:
        conn.execute(
            "UPDATE stability_queue SET attempts = attempts + 1 WHERE file_name = ?",
            (file_name,)
        )


def _drop_from_queue(conn, file_name):
    with conn:
        conn.execute("DELETE FROM stability_queue WHERE file_name = ?", (file_name,))


def _load_context(conn, file_name):
    """Look up bbox + detection metadata for a queued file_name."""
    bbox = conn.execute(
        "SELECT peak_t_s FROM detection_bbox_v1 WHERE file_name = ?",
        (file_name,)
    ).fetchone()
    if bbox is None:
        return None
    det = conn.execute(
        "SELECT Date, Com_Name, Sci_Name, Confidence "
        "FROM detections WHERE File_Name = ? LIMIT 1",
        (file_name,)
    ).fetchone()
    if det is None:
        return None
    date, com, sci, original_conf = det
    return {
        "peak_t_s": float(bbox[0]),
        "date": date,
        "com_name": com,
        "sci_name": sci,
        "original_confidence": float(original_conf),
    }


_INSERT_SQL = """
    INSERT INTO detection_stability_v1
      (file_name, recentered_confidence, ratio_to_original,
       stability_status, algorithm_version, inference_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_name) DO UPDATE SET
      recentered_confidence = excluded.recentered_confidence,
      ratio_to_original     = excluded.ratio_to_original,
      stability_status      = excluded.stability_status,
      algorithm_version     = excluded.algorithm_version,
      inference_ms          = excluded.inference_ms,
      created_at            = excluded.created_at
"""


def _write_result(conn, file_name, recentered_conf, ratio, status, inference_ms):
    with conn:
        conn.execute(_INSERT_SQL, (
            file_name, recentered_conf, ratio, status,
            ALGORITHM_VERSION, inference_ms, int(time.time())
        ))


# ── Audio + inference ─────────────────────────────────────────────────────

def _clip_path(date, com_name, file_name):
    safe = com_name.replace("'", "").replace(" ", "_")
    return CLIPS_ROOT / date / safe / file_name


def _load_recentered_audio(mp3_path, peak_t_s):
    """Read MP3, resample to 32 kHz, slice 5 s centered on peak.

    Pads with zeros if the recentered window falls off either edge —
    Perch needs an exact 160_000-sample input.
    """
    from audio import read_audio  # lazy import (engine module)
    audio = read_audio(str(mp3_path), PERCH_SR)
    half = PERCH_WINDOW_S / 2.0
    start_s = max(0.0, peak_t_s - half)
    start_idx = int(start_s * PERCH_SR)
    end_idx = start_idx + PERCH_WINDOW_SAMPLES
    chunk = audio[start_idx:end_idx]
    if len(chunk) < PERCH_WINDOW_SAMPLES:
        chunk = np.pad(chunk, (0, PERCH_WINDOW_SAMPLES - len(chunk)))
    return chunk


def _infer_species_confidence(perch, chunk, sci_name):
    """Run Perch and pull the probability for sci_name. Returns 0.0 if not found."""
    results = perch.predict(chunk)  # sorted [(label, prob), ...]
    for label, prob in results:
        if label == sci_name:
            return float(prob)
    return 0.0


def _classify_ratio(ratio, stable_th, unstable_th):
    if ratio >= stable_th:
        return "stable"
    if ratio < unstable_th:
        return "unstable"
    return "inconclusive"


# ── Single-shot check (testable without daemon loop) ──────────────────────

def check_one(perch, conn, file_name, *, stable_th=DEFAULT_RATIO_STABLE,
              unstable_th=DEFAULT_RATIO_UNSTABLE, dry_run=False):
    """Run the full stability pipeline on one file. Returns result dict or None.

    Caller is responsible for managing the queue (this only writes the
    result row; it does NOT pop from stability_queue on success).
    """
    ctx = _load_context(conn, file_name)
    if ctx is None:
        log.warning("[stability] no bbox or detection row for %s — skipping", file_name)
        return None
    mp3 = _clip_path(ctx["date"], ctx["com_name"], file_name)
    if not mp3.exists():
        log.warning("[stability] MP3 missing for %s at %s — skipping", file_name, mp3)
        return None

    t0 = time.perf_counter()
    try:
        chunk = _load_recentered_audio(mp3, ctx["peak_t_s"])
        recentered_conf = _infer_species_confidence(perch, chunk, ctx["sci_name"])
    except Exception as e:
        log.warning("[stability] inference failed for %s: %s", file_name, e)
        return None
    inference_ms = int((time.perf_counter() - t0) * 1000)

    original = ctx["original_confidence"]
    if original <= 0:
        ratio = 0.0
    else:
        ratio = recentered_conf / original
    status = _classify_ratio(ratio, stable_th, unstable_th)

    result = {
        "file_name": file_name,
        "sci_name": ctx["sci_name"],
        "original_confidence": original,
        "recentered_confidence": recentered_conf,
        "ratio_to_original": ratio,
        "stability_status": status,
        "inference_ms": inference_ms,
    }
    if not dry_run:
        _write_result(conn, file_name, recentered_conf, ratio, status, inference_ms)
    return result


# ── Worker daemon loop ────────────────────────────────────────────────────

def _engine_busy(quiescent_s):
    """Soft check: if /tmp/birdengine-active sentinel was touched recently, the
    engine is mid-inference. We back off rather than fight for CPU.

    The engine doesn't write this sentinel today (matches Phase 1A backfill's
    behavior). The hook is here so when the engine starts emitting it the
    worker reacts without code changes.
    """
    sentinel = Path("/tmp/birdengine-active")
    if not sentinel.exists():
        return False
    try:
        age = time.time() - sentinel.stat().st_mtime
    except OSError:
        return False
    return age < quiescent_s


def _drain_one(perch, *, max_attempts, stable_th, unstable_th):
    """Open conn, process at most one queue row, close conn. Returns True
    if a row was visited, False if the queue was empty.

    Per-iteration open/close is deliberate. A single long-lived conn
    parked across the polling sleep pins a WAL read snapshot, blocks
    checkpoints, and eventually freezes the engine's INSERTs with
    "database is locked" (incident 2026-05-11 — WAL grew to 28 MB,
    16 h of detections dropped).
    """
    conn = _open_db()
    try:
        row = _peek_next(conn)
        if row is None:
            return False
        file_name, attempts = row
        if attempts >= max_attempts:
            log.warning("[stability] dropping %s after %d attempts",
                        file_name, attempts)
            _drop_from_queue(conn, file_name)
            return True
        _bump_attempts(conn, file_name)
        try:
            res = check_one(perch, conn, file_name,
                            stable_th=stable_th, unstable_th=unstable_th)
        except Exception as e:
            log.exception("[stability] check_one crashed for %s: %s", file_name, e)
            return True  # row stays in queue; attempts already incremented
        if res is not None:
            log.info("[stability] %s status=%s ratio=%.2f conf=%.3f→%.3f (%dms)",
                     file_name, res["stability_status"], res["ratio_to_original"],
                     res["original_confidence"], res["recentered_confidence"],
                     res["inference_ms"])
        # Drop on success OR on unrecoverable skip (no bbox / missing MP3 etc.) —
        # check_one returns None for both, but the warning already fired so
        # leaving it in queue would just spam. Bump-attempts already counted it.
        _drop_from_queue(conn, file_name)
        return True
    finally:
        conn.close()


def worker_loop(perch, *, poll_interval_s=DEFAULT_POLL_INTERVAL_S,
                quiescent_s=DEFAULT_ENGINE_QUIESCENT_S,
                max_attempts=DEFAULT_MAX_ATTEMPTS,
                stable_th=DEFAULT_RATIO_STABLE,
                unstable_th=DEFAULT_RATIO_UNSTABLE):
    """Forever loop: drain stability_queue one item at a time, sleep on empty."""
    log.info("[stability] worker starting (poll=%ds, max_attempts=%d)",
             poll_interval_s, max_attempts)
    while True:
        if _engine_busy(quiescent_s):
            time.sleep(quiescent_s)
            continue
        if not _drain_one(perch, max_attempts=max_attempts,
                          stable_th=stable_th, unstable_th=unstable_th):
            time.sleep(poll_interval_s)


# ── Entry point ───────────────────────────────────────────────────────────

def _load_config():
    """Read [stability_check] section from engine config.toml. Returns dict
    of overrides (empty if section missing)."""
    cfg_path = "/home/bjorn/birdengine/config.toml"
    try:
        import toml
        with open(cfg_path) as f:
            cfg = toml.load(f)
        return cfg.get("stability_check", {})
    except Exception as e:
        log.warning("[stability] could not read %s: %s — using defaults", cfg_path, e)
        return {}


def _load_perch():
    """Load Perch v2 from the engine's models dir. Heavy — call once."""
    from models import get_model
    cfg = _load_config()
    # Models live in the engine runtime dir alongside config.toml — same path
    # the main engine derives from its own base_dir. Override via config.
    models_dir = cfg.get("models_dir", "/home/bjorn/birdengine/models")
    model_name = cfg.get("model", "perch_v2_fp16")
    sensitivity = cfg.get("sensitivity", 1.3)
    log.info("[stability] loading %s from %s …", model_name, models_dir)
    perch = get_model(model_name, models_dir, sensitivity=sensitivity)
    log.info("[stability] Perch loaded.")
    return perch


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s][%(name)s][%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", metavar="FILE_NAME",
                    help="Run a single check on this file and print the result (no DB write).")
    args = ap.parse_args()

    perch = _load_perch()

    if args.once:
        conn = _open_db()
        try:
            res = check_one(perch, conn, args.once, dry_run=True)
        finally:
            conn.close()
        if res is None:
            print("no result (see warnings above)")
            return 1
        for k, v in res.items():
            print(f"  {k}: {v}")
        return 0

    cfg = _load_config()
    worker_loop(
        perch,
        poll_interval_s=cfg.get("poll_interval_s", DEFAULT_POLL_INTERVAL_S),
        quiescent_s=cfg.get("engine_quiescent_s", DEFAULT_ENGINE_QUIESCENT_S),
        max_attempts=cfg.get("max_attempts", DEFAULT_MAX_ATTEMPTS),
        stable_th=cfg.get("ratio_stable", DEFAULT_RATIO_STABLE),
        unstable_th=cfg.get("ratio_unstable", DEFAULT_RATIO_UNSTABLE),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
