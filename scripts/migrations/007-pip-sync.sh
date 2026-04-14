#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 007-pip-sync
#
# Ensures all Python dependencies from engine/requirements.txt are
# installed in the venv. This catches missing packages (like apprise)
# on Pi's that were installed before the dependency was added.
#
# Idempotent: pip install -r is a no-op if everything is already present.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="007-pip-sync"
BIRDASH_DIR="${BIRDASH_DIR:-$HOME/birdash}"
REQ="$BIRDASH_DIR/engine/requirements.txt"

# Find the venv (may be in birdash/engine or birdengine)
if [ -f "$BIRDASH_DIR/engine/venv/bin/pip" ]; then
    VENV="$BIRDASH_DIR/engine/venv"
elif [ -f "$HOME/birdengine/venv/bin/pip" ]; then
    VENV="$HOME/birdengine/venv"
else
    echo "[migrate $NAME] No Python venv found — skipping"
    exit 0
fi

if [ ! -f "$REQ" ]; then
    echo "[migrate $NAME] No requirements.txt — skipping"
    exit 0
fi

echo "[migrate $NAME] Syncing Python dependencies from requirements.txt..."
"$VENV/bin/pip" install -r "$REQ" -q 2>/dev/null

# Also ensure apprise is available system-wide (fallback for all venv layouts)
if ! command -v apprise &>/dev/null && ! [ -f "$VENV/bin/apprise" ]; then
    echo "[migrate $NAME] Installing apprise system-wide..."
    sudo pip3 install apprise -q 2>/dev/null || pip3 install --user apprise -q 2>/dev/null || true
fi
echo "[migrate $NAME] done"
