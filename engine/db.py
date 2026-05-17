"""BirdEngine — SQLite detections DB bootstrap + write.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import logging
import os
import sqlite3

log = logging.getLogger("birdengine")


def resolve_db_path():
    """Resolve the canonical birds.db path the same way the engine does at
    boot — reading `[output] local_db` from `engine/config.toml` — so
    sub-modules (bbox, stability) can't drift onto a stale fixture by
    accident. Falls back to env var / legacy / fresh-install paths only if
    the TOML can't be read.

    Order: $BIRDASH_DB → config.toml output.local_db → ~/BirdNET-Pi/scripts/birds.db
    (legacy upgrade path) → ~/birdash/data/birds.db (fresh install layout).
    """
    env = os.environ.get("BIRDASH_DB")
    if env:
        return env
    cfg_path = os.path.join(os.path.dirname(__file__), "config.toml")
    try:
        import toml
        cfg = toml.load(cfg_path)
        configured = cfg.get("output", {}).get("local_db")
        if configured:
            return os.path.expanduser(configured)
    except Exception:
        pass
    for p in (os.path.expanduser("~/BirdNET-Pi/scripts/birds.db"),
              os.path.expanduser("~/birdash/data/birds.db")):
        if os.path.exists(p):
            return p
    return os.path.expanduser("~/birdash/data/birds.db")


def init_db(db_path):
    """Create the detections database if it doesn't exist + run idempotent migrations."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    # 60 s busy-wait absorbs dawn-chorus contention with three concurrent
    # writers (engine, stability worker, birdash aggregates refresh) plus
    # the WAL checkpoint stalls that can pile on top during heavy traffic.
    # Birdash uses 30 s; the engine staying patient longer means *it*
    # waits rather than raising "database is locked" — at the cost of a
    # slightly slower per-detection insert under contention.
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=60)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=60000")
    # Cap WAL file after each checkpoint. Default is unlimited; on
    # 2026-05-09 birds.db-wal grew to 8.6 GB and blocked all writes
    # because long-lived readers (birdash, stability worker) were
    # preventing checkpoints from completing. 64 MB is well above
    # a dawn-chorus burst.
    conn.execute("PRAGMA journal_size_limit=67108864")
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
    # Canonical detection indexes. Birdash bootstrap (server/lib/db.js)
    # mirrors this list and adds two more (idx_date_conf, idx_date_hour_conf)
    # used by the quality dashboard and weather JOIN heatmap.
    #
    #   idx_date_time — (Date, Time DESC). Last-hour KPI, recent-row scans.
    #   idx_com_name  — (Com_Name).        Common-name lookup.
    #   idx_sci_name  — (Sci_Name).        Sci-name lookup.
    #   idx_date_sci  — (Date, Sci_Name).  Required by INDEXED BY hints in
    #                                      metrics.js (species 30d) and
    #                                      notification-watcher.js. Without
    #                                      it the planner full-scans
    #                                      idx_sci_name (660 ms on 345k rows).
    #   idx_date_com  — (Date, Com_Name).  Required by INDEXED BY hint in
    #                                      quality.js (throttleEffect).
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_sci ON detections(Date, Sci_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_com ON detections(Date, Com_Name)")

    # One-shot cleanup of strict-duplicate indexes carried over from older
    # BirdNET-Pi schema variants. They cost insert time (extra B-tree update
    # per row, painful at dawn chorus) and ~50 MB on disk for zero benefit
    # — same columns, same direction as the canonical names above.
    # Idempotent: no-op once they're gone, no-op on fresh installs.
    for legacy in ("detections_Sci_Name", "detections_Com_Name", "idx_date_sciname"):
        try:
            conn.execute(f"DROP INDEX IF EXISTS {legacy}")
        except sqlite3.OperationalError as e:
            log.warning("[schema] could not drop legacy index %s: %s", legacy, e)

    # Migration: add Source column to existing tables that pre-date multi-source.
    # PRAGMA table_info is the portable way to check column presence on SQLite.
    cols = {row[1] for row in conn.execute("PRAGMA table_info(detections)").fetchall()}
    if "Source" not in cols:
        conn.execute("ALTER TABLE detections ADD COLUMN Source TEXT")
    # Audio_Purged_At: unix timestamp set by birdash's auto-purge when the
    # MP3 is deleted. NULL means audio still on disk. Engine doesn't read
    # or set it — purely a birdash concern — but the column lives on the
    # detections table so the migration must happen here too.
    if "Audio_Purged_At" not in cols:
        conn.execute("ALTER TABLE detections ADD COLUMN Audio_Purged_At INTEGER")

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
