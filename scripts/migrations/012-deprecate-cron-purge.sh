#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 012-deprecate-cron-purge
#
# Remove the legacy purge_audio.sh cron entry installed on bird before
# birdash took over the auto-purge policy in 1.55.0. The cron used to run
# at 03:00 daily, but it triggered only when disk > PURGE_THRESHOLD —
# meaning AUDIO_RETENTION_DAYS was never applied proactively. On mickey
# (birdash-only install, no BirdNET-Pi) the cron wasn't even present,
# clips accumulated 25 days, hit 87 % disk, ENOSPC corrupted git mid-fetch.
#
# Birdash 1.55.0 owns the schedule end-to-end via server/lib/auto-purge.js.
# This migration removes the cron entry; the purge_audio.sh script itself
# is kept for now in case anyone wants to run it manually.
#
# Idempotent: scans crontab, removes the line if present, no-op otherwise.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="012-deprecate-cron-purge"

# Match the line we installed (matches either ~/birdengine/purge_audio.sh
# or ~/birdash/engine/purge_audio.sh — different installs have different
# paths).
PATTERN='purge_audio\.sh'

# Read current crontab (empty if none — crontab -l returns 1 in that case).
CURRENT=$(crontab -l 2>/dev/null || true)

if ! echo "$CURRENT" | grep -q "$PATTERN"; then
    echo "[migrate $NAME] no purge_audio.sh cron entry — nothing to do"
    exit 0
fi

# Write the filtered crontab back. `crontab -` reads stdin, replaces the
# whole crontab. Using `grep -v` is safe for this single-line pattern.
echo "$CURRENT" | grep -v "$PATTERN" | crontab -

echo "[migrate $NAME] removed legacy purge_audio.sh cron entry"
echo "[migrate $NAME] birdash now owns the auto-purge schedule (server/lib/auto-purge.js)"
