#!/usr/bin/env python3
"""
Phase 1A — Migration : ajoute la table `detection_bbox_v1` à birds.db.

Idempotent (CREATE TABLE IF NOT EXISTS). Brève écriture WAL, n'interrompt
pas le moteur en cours grâce au mode journal WAL déjà actif.

Le moteur live n'utilise pas cette table — c'est purement de la métadonnée
calculée à part. Aucune FK vers `detections` (qui n'a pas de PK) : la clé
primaire est `file_name`, l'identifiant naturel de chaque détection.

Usage : nice -n 19 ionice -c 3 python3 scripts/refinement/migrate_phase1a.py
"""

import sqlite3
import sys
from pathlib import Path

_HOME = Path.home()
DB_PATH = str(_HOME / "BirdNET-Pi" / "scripts" / "birds.db") if (_HOME / "BirdNET-Pi" / "scripts" / "birds.db").exists() else str(_HOME / "birdash" / "data" / "birds.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS detection_bbox_v1 (
  file_name           TEXT PRIMARY KEY,
  t_min_s             REAL NOT NULL,
  t_max_s             REAL NOT NULL,
  f_min_hz            REAL NOT NULL,
  f_max_hz            REAL NOT NULL,
  peak_t_s            REAL,
  peak_energy         REAL,
  snr_estimate        REAL,
  truncated           INTEGER DEFAULT 0,
  algorithm_version   TEXT NOT NULL DEFAULT 'heuristic_v1',
  created_at          INTEGER NOT NULL
);
"""

INDEX_ALGO = """
CREATE INDEX IF NOT EXISTS idx_bbox_v1_algo
  ON detection_bbox_v1(algorithm_version);
"""


def main():
    print(f"[migrate] DB: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode")
        mode = cur.fetchone()[0]
        if mode.lower() != "wal":
            print(f"[migrate] WARNING: journal_mode={mode} (attendu: wal)")

        existed = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='detection_bbox_v1'"
        ).fetchone()

        cur.executescript(SCHEMA + INDEX_ALGO)
        conn.commit()

        if existed:
            n = cur.execute("SELECT COUNT(*) FROM detection_bbox_v1").fetchone()[0]
            print(f"[migrate] Table déjà présente, {n} bbox existants.")
        else:
            print("[migrate] Table detection_bbox_v1 créée.")

        # Affiche le schéma résultant pour traçabilité
        cur.execute("SELECT sql FROM sqlite_master WHERE name='detection_bbox_v1'")
        print("[migrate] Schéma :")
        print(cur.fetchone()[0])
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
