#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 002-birdash-killmode-process
#
# When the dashboard's "Installer maintenant" runs, /api/apply-update
# spawns scripts/update.sh detached. update.sh later does
#   sudo systemctl restart birdash
# and then keeps running to write its final "done" status to
# config/update-progress.json so the UI can confirm success.
#
# Without KillMode=process, systemd's default (control-group) kills
# the entire birdash cgroup on restart — including the supposedly
# detached update.sh. The script dies right after the restart command
# and never writes "done", leaving the dashboard polling forever.
#
# This migration adds `KillMode=process` to the [Service] block of
# /etc/systemd/system/birdash.service if it isn't already there, then
# runs daemon-reload. The actual restart that picks up the new
# setting happens later in the same update.sh run, which means the
# CURRENT update is still affected — but the NEXT one will work
# correctly.
#
# Idempotent: bails out if KillMode=process is already present.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="002-birdash-killmode-process"
UNIT="/etc/systemd/system/birdash.service"

if [ ! -f "$UNIT" ]; then
    echo "[migrate $NAME] $UNIT not found — skipping"
    exit 0
fi

if grep -q "^KillMode=process" "$UNIT"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

# Backup so the user can roll back if anything goes wrong.
sudo cp "$UNIT" "$UNIT.before-$NAME"

# Insert KillMode=process right after the [Service] header. Idempotent
# even if the file is rewritten on a future install — we re-check the
# grep above next time.
sudo sed -i '/^\[Service\]/a KillMode=process' "$UNIT"

sudo systemctl daemon-reload
echo "[migrate $NAME] added KillMode=process to birdash.service (backup: $UNIT.before-$NAME)"
echo "[migrate $NAME] daemon-reload done — takes effect on next restart"
