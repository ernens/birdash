#!/usr/bin/env python3
"""
Phase 2 — Migration : ajoute `detection_stability_v1` et `stability_queue`
à birds.db. Idempotent (CREATE TABLE IF NOT EXISTS).

`detection_stability_v1` stocke le résultat d'une re-inférence Perch
recentrée sur le pic d'énergie du Niveau 1. PK = file_name comme
detection_bbox_v1 (pas de FK vers detections, qui n'a pas de PK
unique).

`stability_queue` accumule les détections candidates en attente de
traitement. Le worker dépile par enqueued_at ASC et incrémente
`attempts` à chaque tentative (utile pour limiter les retries).

Usage : python3 scripts/refinement/migrate_phase2.py
"""

import sqlite3
import sys
from pathlib import Path

_HOME = Path.home()
DB_PATH = str(_HOME / "BirdNET-Pi" / "scripts" / "birds.db") if (_HOME / "BirdNET-Pi" / "scripts" / "birds.db").exists() else str(_HOME / "birdash" / "data" / "birds.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS detection_stability_v1 (
  file_name              TEXT PRIMARY KEY,
  recentered_confidence  REAL NOT NULL,
  ratio_to_original      REAL NOT NULL,
  stability_status       TEXT NOT NULL,
  algorithm_version      TEXT NOT NULL DEFAULT 'stability_v1',
  inference_ms           INTEGER,
  created_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stability_v1_status
  ON detection_stability_v1(stability_status);

CREATE TABLE IF NOT EXISTS stability_queue (
  file_name    TEXT PRIMARY KEY,
  enqueued_at  INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stability_queue_enqueued
  ON stability_queue(enqueued_at);
"""


def main():
    print(f"[migrate-phase2] DB: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode")
        mode = cur.fetchone()[0]
        if mode.lower() != "wal":
            print(f"[migrate-phase2] WARNING: journal_mode={mode} (attendu: wal)")
        cur.executescript(SCHEMA)
        conn.commit()
        for tbl in ("detection_stability_v1", "stability_queue"):
            n = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
            print(f"[migrate-phase2] {tbl}: {n} rows")
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
