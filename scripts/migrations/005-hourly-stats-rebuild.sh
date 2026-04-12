#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 005-hourly-stats-rebuild
#
# New hourly_stats pre-aggregated table added in v1.5.53. The table
# is created by aggregates.createTables() on startup, but historical
# data is only populated during a full rebuildAll(). This migration
# touches the sentinel file so the next birdash restart triggers a
# full rebuild instead of just refreshToday.
#
# Idempotent: bails out if hourly_stats already has data.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="005-hourly-stats-rebuild"
REPO_DIR="${BIRDASH_DIR:-$HOME/birdash}"
DB="${BIRDASH_DB:-}"
if [ -z "$DB" ] || [ ! -f "$DB" ]; then DB="$HOME/BirdNET-Pi/scripts/birds.db"; fi
if [ ! -f "$DB" ]; then DB="$REPO_DIR/data/birds.db"; fi
if [ ! -f "$DB" ]; then
    echo "[migrate $NAME] no birds.db found — skipping"
    exit 0
fi

# Check if hourly_stats exists AND has data
HAS_DATA=$(sqlite3 "$DB" "SELECT COUNT(*) FROM hourly_stats" 2>/dev/null || echo "0")
if [ "$HAS_DATA" != "0" ] && [ "$HAS_DATA" -gt 10 ]; then
    echo "[migrate $NAME] already applied ($HAS_DATA rows in hourly_stats)"
    exit 0
fi

# Touch sentinel to trigger full rebuild on next birdash restart
touch "$REPO_DIR/config/.rebuild-aggregates"
echo "[migrate $NAME] sentinel created — full aggregate rebuild (including hourly_stats) will run on next birdash restart"
