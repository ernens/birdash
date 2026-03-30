#!/bin/bash
# Purge old BirdSongs audio files to manage disk space
# Runs daily via cron at 3am. Reads config from birdnet.conf.

BIRDSONGS_DIR="$HOME/BirdSongs"
CONF="/etc/birdnet/birdnet.conf"

# Read settings from birdnet.conf
KEEP_DAYS=$(grep -oP 'AUDIO_RETENTION_DAYS=\K\d+' "$CONF" 2>/dev/null || echo 90)
DISK_THRESH=$(grep -oP 'PURGE_THRESHOLD=\K\d+' "$CONF" 2>/dev/null || echo 90)
FULL_DISK=$(grep -oP 'FULL_DISK=\K\w+' "$CONF" 2>/dev/null || echo purge)

# Override from argument if provided
[ -n "$1" ] && KEEP_DAYS=$1

USAGE=$(df --output=pcent / | tail -1 | tr -d ' %')

echo "[purge] $(date '+%Y-%m-%d %H:%M') Disk: ${USAGE}% | Threshold: ${DISK_THRESH}% | Retention: ${KEEP_DAYS}d | Mode: ${FULL_DISK}"

if [ "$FULL_DISK" != "purge" ]; then
    echo "[purge] Mode is '${FULL_DISK}', skipping purge"
    exit 0
fi

if [ "$USAGE" -lt "$DISK_THRESH" ]; then
    echo "[purge] Disk below threshold — no purge needed"
    exit 0
fi

echo "[purge] Purging audio older than ${KEEP_DAYS} days..."

FREED=0

# Purge old extracted clips (By_Date/YYYY-MM-DD directories)
while IFS= read -r dir; do
    SIZE=$(du -sb "$dir" 2>/dev/null | cut -f1)
    echo "[purge] Removing extracted: $(basename "$dir") ($(du -sh "$dir" | cut -f1))"
    rm -rf "$dir"
    FREED=$((FREED + SIZE))
done < <(find "$BIRDSONGS_DIR/Extracted/By_Date/" -maxdepth 1 -type d -mtime +${KEEP_DAYS} 2>/dev/null)

# Purge old monthly audio directories
for dir in "$BIRDSONGS_DIR"/*/; do
    dirname=$(basename "$dir")
    case "$dirname" in
        Extracted|Processed|StreamData) continue ;;
    esac
    # Check if newest file in dir is older than KEEP_DAYS
    NEWEST=$(find "$dir" -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
    CUTOFF=$(date -d "-${KEEP_DAYS} days" +%s)
    if [ -n "$NEWEST" ] && [ "${NEWEST%.*}" -lt "$CUTOFF" ]; then
        SIZE=$(du -sb "$dir" 2>/dev/null | cut -f1)
        echo "[purge] Removing month: $dirname ($(du -sh "$dir" | cut -f1))"
        rm -rf "$dir"
        FREED=$((FREED + SIZE))
    fi
done

FREED_MB=$((FREED / 1048576))
NEW_USAGE=$(df --output=pcent / | tail -1 | tr -d ' %')
echo "[purge] Done. Freed ${FREED_MB} MB. Disk now at ${NEW_USAGE}%"
