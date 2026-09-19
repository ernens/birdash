#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 013-deadman-switch
#
# Install the external heartbeat (dead-man switch) as a systemd timer.
#
# alerts.js watches ten conditions, but all of them run on the station
# itself. A host without power cannot report its own death: that is how
# bird's power loss of 2026-07-07 07:59 stayed invisible for 72 days, until
# the Pi was unplugged and replugged on 2026-09-18. 434k detections, and a
# 72-day hole nobody was told about.
#
# The timer is deliberately independent of birdash (Node) and birdengine
# (Python) — only systemd sits in the loop. It pings an external monitor;
# when the pings stop, the monitor alerts the operator.
#
# The units are generated here rather than copied from config/ so that $HOME
# and the service user are correct on every install (bird, mickey, biloute
# all differ).
#
# Idempotent: rewrites the units, reloads systemd, enables the timer. Never
# touches an existing config/deadman.json.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="013-deadman-switch"
REPO_DIR="${REPO_DIR:-$HOME/birdash}"
SCRIPT="$REPO_DIR/scripts/deadman.sh"
CONFIG="$REPO_DIR/config/deadman.json"
SVC=/etc/systemd/system/birdash-deadman.service
TIMER=/etc/systemd/system/birdash-deadman.timer

if [ ! -f "$SCRIPT" ]; then
    echo "[migrate $NAME] $SCRIPT missing — skipping"
    exit 0
fi
chmod +x "$SCRIPT"

# Seed a disabled config. An empty "url" makes deadman.sh log a line and exit
# cleanly, so enabling the timer before the operator has an endpoint is safe.
if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" <<'JSON'
{
  "url": "",
  "fail_url": "",
  "db": "",
  "services": ["birdengine", "birdengine-recording", "birdash", "caddy"],
  "max_detection_age_min": 0,
  "min_free_pct": 10,
  "fail_on_undervoltage": false,
  "timeout_sec": 10
}
JSON
    echo "[migrate $NAME] seeded $CONFIG (url empty — switch inactive until set)"
else
    echo "[migrate $NAME] $CONFIG already present, left untouched"
fi

RUN_USER="$(id -un)"

sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=BirdStation dead-man switch — external heartbeat
Documentation=file:$REPO_DIR/docs/README-deadman.md
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
ExecStart=$SCRIPT
TimeoutStartSec=60
# Exit 1 means "monitor unreachable" — real information, not a unit failure.
# Without this the timer would flap into failed state on any network blip.
SuccessExitStatus=0 1
UNIT

sudo tee "$TIMER" >/dev/null <<'UNIT'
[Unit]
Description=Run the BirdStation dead-man switch every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Unit=birdash-deadman.service

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now birdash-deadman.timer >/dev/null 2>&1

echo "[migrate $NAME] timer installed and enabled (every 5 min, user $RUN_USER)"
echo "[migrate $NAME] set \"url\" in config/deadman.json to activate — see docs/README-deadman.md"
