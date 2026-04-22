"""BirdEngine — SQLite detections DB bootstrap + write.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import logging
import os
import sqlite3

log = logging.getLogger("birdengine")


def init_db(db_path):
    """Create the detections database if it doesn't exist."""
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
            Model VARCHAR(50)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)")
    conn.commit()
    return conn


def write_detection(conn, det):
    """Insert a detection row if not already present (avoids duplicates on restart)."""
    existing = conn.execute(
        "SELECT 1 FROM detections WHERE Date=? AND Time=? AND Sci_Name=? AND Model=? LIMIT 1",
        (det["date"], det["time"], det["sci_name"], det["model"])
    ).fetchone()
    if existing:
        return False
    conn.execute(
        "INSERT INTO detections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (det["date"], det["time"], det["sci_name"], det["com_name"],
         det["confidence"], det["lat"], det["lon"], det["cutoff"],
         det["week"], det["sens"], det["overlap"], det["file_name"],
         det["model"])
    )
    conn.commit()
    return True
