"""BirdEngine — SQLite detections DB bootstrap + write.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import logging
import os
import sqlite3

log = logging.getLogger("birdengine")


def init_db(db_path):
    """Create the detections database if it doesn't exist + run idempotent migrations."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    # timeout=30 gives us a 30 s busy-wait when birdash is holding the
    # write lock (aggregates rebuild, alerts query, etc.) — well beyond
    # Node's busy_timeout=5000 so we're the patient party rather than
    # the one raising "database is locked".
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            Date DATE,
            Time TIME,
            Sci_Name VARCHAR(100) NOT NULL,
            Com_Name VARCHAR(100) NOT NULL,
            Confidence FLOAT,
            Lat FLOAT,
            Lon FLOAT,
            Cutoff FLOAT,
            Week INT,
            Sens FLOAT,
            Overlap FLOAT,
            File_Name VARCHAR(100) NOT NULL,
            Model VARCHAR(50),
            Source TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)")

    # Migration: add Source column to existing tables that pre-date multi-source.
    # PRAGMA table_info is the portable way to check column presence on SQLite.
    cols = {row[1] for row in conn.execute("PRAGMA table_info(detections)").fetchall()}
    if "Source" not in cols:
        conn.execute("ALTER TABLE detections ADD COLUMN Source TEXT")

    # Quality events — engine-emitted hourly counters consumed by the
    # Quality page. Definitions live in docs/QUALITY_METRICS.md; never
    # add a column here without a matching entry in that spec.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS quality_events (
            Date TEXT NOT NULL,
            Hour INTEGER NOT NULL,
            cross_confirm_rejected INTEGER DEFAULT 0,
            privacy_dropped        INTEGER DEFAULT 0,
            dog_dropped            INTEGER DEFAULT 0,
            dog_cooldown_skipped   INTEGER DEFAULT 0,
            throttle_dropped       INTEGER DEFAULT 0,
            files_processed        INTEGER DEFAULT 0,
            PRIMARY KEY (Date, Hour)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_quality_date ON quality_events(Date)")

    conn.commit()
    return conn


def upsert_quality_events(conn, date, hour, counters):
    """Merge a partial counter snapshot into the per-(date, hour) row.

    Uses INSERT … ON CONFLICT DO UPDATE so callers don't have to know
    whether the row already exists. Counters are added (not replaced) so
    flushing twice in the same hour just sums them up.

    `counters` is a dict with any subset of:
      cross_confirm_rejected, privacy_dropped, dog_dropped,
      dog_cooldown_skipped, throttle_dropped, files_processed
    """
    keys = ["cross_confirm_rejected", "privacy_dropped", "dog_dropped",
            "dog_cooldown_skipped", "throttle_dropped", "files_processed"]
    values = {k: int(counters.get(k, 0)) for k in keys}
    cols = ", ".join(keys)
    placeholders = ", ".join("?" * len(keys))
    update_clause = ", ".join(f"{k} = {k} + excluded.{k}" for k in keys)
    conn.execute(
        f"INSERT INTO quality_events (Date, Hour, {cols}) VALUES (?, ?, {placeholders}) "
        f"ON CONFLICT (Date, Hour) DO UPDATE SET {update_clause}",
        (date, int(hour), *[values[k] for k in keys])
    )
    conn.commit()


def write_detection(conn, det):
    """Insert a detection row if not already present (avoids duplicates on restart).

    `det['source']` is optional — None means single-source / legacy origin
    (the column stays NULL). When set, it carries the source key (e.g.
    'garden', 'feeder', 'nestbox') derived from the recording subdirectory.
    """
    existing = conn.execute(
        "SELECT 1 FROM detections WHERE Date=? AND Time=? AND Sci_Name=? AND Model=? LIMIT 1",
        (det["date"], det["time"], det["sci_name"], det["model"])
    ).fetchone()
    if existing:
        return False
    conn.execute(
        "INSERT INTO detections (Date, Time, Sci_Name, Com_Name, Confidence,"
        " Lat, Lon, Cutoff, Week, Sens, Overlap, File_Name, Model, Source) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (det["date"], det["time"], det["sci_name"], det["com_name"],
         det["confidence"], det["lat"], det["lon"], det["cutoff"],
         det["week"], det["sens"], det["overlap"], det["file_name"],
         det["model"], det.get("source"))
    )
    conn.commit()
    return True
