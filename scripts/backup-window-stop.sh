#!/usr/bin/env bash
# BIRDASH — Backup nightly window: stop
# Called at 05:00 by cron. Sends SIGSTOP to backup.sh + rsync to pause without
# losing in-memory state. Status is updated to "paused" so the UI shows it.
set -uo pipefail

STATUS_FILE="/home/bjorn/birdash/config/backup-status.json"
LOG_FILE="$HOME/.local/share/birdash-backup.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Write directly to LOG_FILE — using tee -a here would double each line
# because cron also redirects stdout via `>> $LOG_FILE 2>&1`. Stderr from
# unexpected shell errors still reaches the log via cron's redirect.
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [window-stop] $*" >> "$LOG_FILE"; }

BASH_PIDS=$(pgrep -f "scripts/backup\.sh" 2>/dev/null || true)
RSYNC_PIDS=$(pgrep -f "rsync.*birdash-backup\|rsync.*BirdSongs" 2>/dev/null || true)
ALL_PIDS="$BASH_PIDS $RSYNC_PIDS"

if [ -z "${ALL_PIDS// /}" ]; then
  log "No backup process found — nothing to pause"
  exit 0
fi

log "Pausing backup (PIDs: $ALL_PIDS)"
# shellcheck disable=SC2086
kill -STOP $ALL_PIDS 2>/dev/null || true

node -e "
  const fs=require('fs');
  try{
    const s=JSON.parse(fs.readFileSync('$STATUS_FILE','utf8'));
    s.state='paused';
    s.detail='Pause (fenêtre nuit terminée)';
    s.updatedAt=new Date().toISOString();
    fs.writeFileSync('$STATUS_FILE',JSON.stringify(s));
  }catch(e){}
" 2>/dev/null || true
log "Paused"
