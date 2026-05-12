#!/usr/bin/env bash
# BIRDASH — Backup nightly window: start
# Called at 22:00 by cron. If a paused backup exists, resume it (SIGCONT).
# Otherwise, launch a fresh backup.sh in the background.
set -uo pipefail

CONFIG_FILE="/home/bjorn/birdash/config/backup.json"
STATUS_FILE="/home/bjorn/birdash/config/backup-status.json"
SCRIPT="/home/bjorn/birdash/scripts/backup.sh"
LOG_FILE="$HOME/.local/share/birdash-backup.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Write directly to LOG_FILE — using tee -a here would double each line
# because cron also redirects stdout via `>> $LOG_FILE 2>&1`. Stderr from
# unexpected shell errors still reaches the log via cron's redirect.
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [window-start] $*" >> "$LOG_FILE"; }

BASH_PIDS=$(pgrep -f "scripts/backup\.sh" 2>/dev/null || true)
RSYNC_PIDS=$(pgrep -f "rsync.*birdash-backup\|rsync.*BirdSongs" 2>/dev/null || true)
ALL_PIDS="$BASH_PIDS $RSYNC_PIDS"

if [ -n "${BASH_PIDS// /}" ]; then
  STATE=$(node -e "try{console.log(require('$STATUS_FILE').state||'')}catch(e){console.log('')}" 2>/dev/null)
  if [ "$STATE" = "paused" ]; then
    log "Backup paused — sending SIGCONT (PIDs: $ALL_PIDS)"
    # shellcheck disable=SC2086
    kill -CONT $ALL_PIDS 2>/dev/null || true
    node -e "
      const fs=require('fs');
      try{
        const s=JSON.parse(fs.readFileSync('$STATUS_FILE','utf8'));
        s.state='running';
        s.detail='Reprise (fenêtre nuit)';
        s.updatedAt=new Date().toISOString();
        fs.writeFileSync('$STATUS_FILE',JSON.stringify(s));
      }catch(e){}
    " 2>/dev/null || true
    log "Resumed"
  else
    log "Backup already running (state=$STATE) — no-op"
  fi
  exit 0
fi

log "No active backup — starting fresh"
BACKUP_CONFIG="$CONFIG_FILE" BACKUP_STATUS="$STATUS_FILE" \
  nohup bash "$SCRIPT" >> "$LOG_FILE" 2>&1 &
log "Launched PID=$!"
