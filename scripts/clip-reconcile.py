#!/usr/bin/env python3
"""
clip-reconcile.py — Reconcile the detections table against the clips on disk.

auto-purge.js deletes clips by policy, but nothing ever checks that the two
sides still agree. Drift accumulates silently in both directions:

  * rows whose clip is gone      -> the UI offers a player that 404s
  * clips with no row            -> disk held forever, invisible to the purge
  * zero-byte files              -> written by a process killed mid-write
                                    (two such WAVs survive in the incoming
                                    directory, one stamped 2026-07-07 08:00:03,
                                    the moment of the power cut)

Read-only by default: it reports and exits. Nothing is deleted without --fix,
which is not implemented yet — by design, look before you touch.

Path mapping follows buildAudioUrl() in public/js/bird-shared.js:
    <species>-<confidence>-<date>-birdnet-<time>.mp3
      -> By_Date/<date>/<species>/<filename>
The non-greedy group matters: species names carry hyphens of their own
(Gros-bec_casse-noyaux), so splitting on '-' would mangle them.
"""

import argparse
import os
import re
import sqlite3
import sys
from collections import Counter

NAME_RE = re.compile(r'^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-')


def human(n):
    for unit in ('o', 'Ko', 'Mo', 'Go'):
        if abs(n) < 1024:
            return f"{n:.0f} {unit}" if unit == 'o' else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} To"


def rel_path(file_name):
    """Relative path under By_Date, or None when the name doesn't parse."""
    m = NAME_RE.match(file_name)
    if not m:
        return None
    return f"{m.group(2)}/{m.group(1)}/{file_name}"


def scan_disk(root):
    """Return {relpath: size} for every file under By_Date/<date>/<species>/."""
    found = {}
    if not os.path.isdir(root):
        return found
    for date_entry in os.scandir(root):
        if not date_entry.is_dir():
            continue
        for sp_entry in os.scandir(date_entry.path):
            if not sp_entry.is_dir():
                continue
            for f in os.scandir(sp_entry.path):
                if f.is_file():
                    rel = f"{date_entry.name}/{sp_entry.name}/{f.name}"
                    try:
                        found[rel] = f.stat().st_size
                    except OSError:
                        found[rel] = -1
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--db', default=os.path.expanduser('~/BirdNET-Pi/scripts/birds.db'))
    ap.add_argument('--clips', default=os.path.expanduser('~/BirdSongs/Extracted/By_Date'))
    ap.add_argument('--incoming', default=os.path.expanduser('~/birdengine/audio/incoming'))
    ap.add_argument('--limit-examples', type=int, default=5)
    ap.add_argument('--fix', action='store_true',
                    help='not implemented — reconcile read-only first')
    args = ap.parse_args()

    if args.fix:
        print("--fix is not implemented. Review the report first.", file=sys.stderr)
        return 2

    if not os.path.exists(args.db):
        print(f"database not found: {args.db}", file=sys.stderr)
        return 1

    print("=== Réconciliation clips ↔ base (LECTURE SEULE) ===")
    print(f"Base   : {args.db}")
    print(f"Clips  : {args.clips}\n")

    # Read-only, immutable: never take a write lock on the live database.
    uri = f"file:{args.db}?mode=ro&immutable=1"
    con = sqlite3.connect(uri, uri=True)
    rows = con.execute(
        "SELECT File_Name, Date, Audio_Purged_At FROM detections"
    ).fetchall()
    con.close()

    expected = {}           # relpath -> (date, purged)
    unparseable = []
    purged_rows = 0
    for file_name, date, purged in rows:
        if not file_name:
            unparseable.append((date, file_name))
            continue
        rel = rel_path(file_name)
        if rel is None:
            unparseable.append((date, file_name))
            continue
        if purged is not None:
            purged_rows += 1
            continue        # the clip is gone on purpose
        expected[rel] = date

    disk = scan_disk(args.clips)
    mp3 = {k: v for k, v in disk.items() if k.endswith('.mp3')}
    png = {k: v for k, v in disk.items() if k.endswith('.png')}

    missing = {k: v for k, v in expected.items() if k not in mp3}
    orphans = {k: v for k, v in mp3.items() if k not in expected}
    empty = {k: v for k, v in disk.items() if v == 0}
    # A spectrogram is stored as <clip>.mp3.png, so strip '.png' to get the
    # clip path. It is orphaned when no row expects that clip — whether or not
    # the mp3 itself still sits on disk. Requiring the mp3 to be missing too
    # hid every spectrogram paired with an orphan clip, and those are the bulk
    # of the reclaimable space: a png runs ~650 Ko against ~97 Ko for its mp3.
    png_orphans = {k: v for k, v in png.items() if k[:-4] not in expected}

    total_rows = len(rows)
    print(f"Lignes en base                 : {total_rows}")
    print(f"  attendant un fichier         : {len(expected)}")
    print(f"    présent                    : {len(expected) - len(missing)}")
    pct = (100.0 * len(missing) / len(expected)) if expected else 0
    print(f"    MANQUANT                   : {len(missing)}  ({pct:.1f} %)")
    print(f"  audio purgé volontairement   : {purged_rows}  (aucun fichier attendu)")
    print(f"  nom de fichier illisible     : {len(unparseable)}")
    print()
    print(f"Fichiers sur disque            : {len(mp3)} mp3, {len(png)} png")
    print(f"  mp3 orphelins (aucune ligne) : {len(orphans)}  ({human(sum(orphans.values()))})")
    print(f"  png orphelins                : {len(png_orphans)}  ({human(sum(png_orphans.values()))})")
    print(f"  fichiers de 0 octet          : {len(empty)}")

    if missing:
        print("\n— Fichiers manquants par mois —")
        for month, n in sorted(Counter(d[:7] for d in missing.values()).items()):
            print(f"    {month}  {n}")
        print("  exemples :")
        for rel in list(missing)[:args.limit_examples]:
            print(f"    {rel}")

    if orphans:
        print("\n— Orphelins par mois —")
        for month, n in sorted(Counter(k[:7] for k in orphans).items()):
            print(f"    {month}  {n}")
        print("  exemples :")
        for rel in list(orphans)[:args.limit_examples]:
            print(f"    {rel}")

    if empty:
        print("\n— Fichiers de 0 octet —")
        for rel in list(empty)[:args.limit_examples]:
            print(f"    {rel}")

    # The incoming directory is arecord's, not the clip store's, but a
    # zero-byte WAV left by a killed process belongs in the same report.
    if os.path.isdir(args.incoming):
        stale = [(f.name, f.stat().st_size)
                 for f in os.scandir(args.incoming)
                 if f.is_file() and f.name.endswith('.wav')]
        zero = [n for n, s in stale if s == 0]
        if zero:
            print(f"\n— incoming/ : {len(zero)} WAV de 0 octet (processus tué en cours d'écriture) —")
            for n in zero[:args.limit_examples]:
                print(f"    {n}")

    # detection_bbox_v1 and detection_stability_v1 are keyed by file_name and
    # drift the same way. Rows here outlive the detections they describe.
    con = sqlite3.connect(uri, uri=True)
    det_names = {r[0] for r in con.execute("SELECT File_Name FROM detections") if r[0]}
    for table in ('detection_bbox_v1', 'detection_stability_v1'):
        try:
            names = {r[0] for r in con.execute(f"SELECT file_name FROM {table}") if r[0]}
        except sqlite3.Error:
            continue
        dangling = names - det_names
        pct = (100.0 * len(dangling) / len(names)) if names else 0
        print(f"\n{table} : {len(names)} lignes, "
              f"{len(dangling)} sans détection ({pct:.1f} %)")
    con.close()

    total_reclaim = sum(orphans.values()) + sum(png_orphans.values())
    print(f"\nEspace récupérable en supprimant les orphelins : {human(total_reclaim)}")
    print("Aucune modification effectuée.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
