#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 014-audio-watchdog
#
# Install the capture-chain liveness watchdog as a systemd timer.
#
# alerts.js flags a mic that is too quiet or too loud, but skips once the
# sound readings go stale — it assumes the service-down alert covers that.
# It doesn't: birdengine-recording.service can sit `active` while arecord
# produces nothing (re-enumerated USB mic, vanished ALSA device). systemd
# sees a live process, the readings are stale so the sound alert abstains,
# and the station records silence with nobody told.
#
# The watchdog checks what arecord actually produces — the newest WAV in the
# incoming directory — and restarts the recording service, then the engine,
# then backs off rather than looping on a dead mic.
#
# Units are generated here rather than copied from config/ so $HOME and the
# service user are right on every install (bird, mickey, ...).
#
# Idempotent: rewrites the units, reloads systemd, enables the timer, and
# never overwrites an existing config/audio-watchdog.json.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="014-audio-watchdog"
REPO_DIR="${REPO_DIR:-$HOME/birdash}"
SCRIPT="$REPO_DIR/scripts/audio-watchdog.sh"
CONFIG="$REPO_DIR/config/audio-watchdog.json"
SVC=/etc/systemd/system/birdash-audio-watchdog.service
TIMER=/etc/systemd/system/birdash-audio-watchdog.timer

if [ ! -f "$SCRIPT" ]; then
    echo "[migrate $NAME] $SCRIPT missing — skipping"
    exit 0
fi
chmod +x "$SCRIPT"

if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" <<'JSON'
{
  "enabled": true,
  "incoming_dir": "",
  "stall_sec": 300,
  "restart_grace_sec": 180,
  "max_restarts_per_hour": 3,
  "recording_service": "birdengine-recording",
  "engine_service": "birdengine",
  "notify": true
}
JSON
    echo "[migrate $NAME] seeded $CONFIG"
else
    echo "[migrate $NAME] $CONFIG already present, left untouched"
fi

RUN_USER="$(id -un)"

sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=BirdStation audio capture watchdog
Documentation=file:$REPO_DIR/docs/README-audio-watchdog.md
After=network.target

[Service]
Type=oneshot
User=$RUN_USER
ExecStart=$SCRIPT
TimeoutStartSec=120
# Exit 1 means "stalled and backing off" — a real state, not a unit failure.
SuccessExitStatus=0 1
UNIT

sudo tee "$TIMER" >/dev/null <<'UNIT'
[Unit]
Description=Run the BirdStation audio watchdog every 2 minutes

[Timer]
# Start late enough that a fresh boot has had time to produce its first WAV.
OnBootSec=5min
OnUnitActiveSec=2min
AccuracySec=20s
Unit=birdash-audio-watchdog.service

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now birdash-audio-watchdog.timer >/dev/null 2>&1

echo "[migrate $NAME] timer installed and enabled (every 2 min, user $RUN_USER)"
echo "[migrate $NAME] tune thresholds in config/audio-watchdog.json — see docs/README-audio-watchdog.md"
