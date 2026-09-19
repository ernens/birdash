#!/usr/bin/env bash
#
# deadman.sh — External heartbeat ("dead-man switch") for the BirdStation.
#
# Pings an external monitor on every run. When the station dies — power loss,
# kernel panic, severed network — the pings stop and the *monitor* alerts you.
#
# Deliberately independent of birdash (Node) and birdengine (Python): an on-box
# watchdog cannot report its own host's death. That is exactly how the
# 2026-07-07 power loss went unnoticed for 72 days, despite alerts.js already
# monitoring ten conditions.
#
# Config: config/deadman.json     Log: config/deadman.log
# Run by: birdash-deadman.timer (every 5 min)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIRDASH_DIR="${BIRDASH_DIR:-$(dirname "$SCRIPT_DIR")}"
HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"
CONFIG="$BIRDASH_DIR/config/deadman.json"
LOG="$BIRDASH_DIR/config/deadman.log"
LOCKFILE="/run/lock/birdash-deadman.lock"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null; }

# Bound the log — this runs every 5 minutes, forever.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  tail -c 131072 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# Never let a slow curl stack runs up.
exec 9>"$LOCKFILE" 2>/dev/null || true
flock -n 9 2>/dev/null || { log "skip: run already in progress"; exit 0; }

# ── Config ──────────────────────────────────────────────────────────────────
declare -A CFG=()
while IFS=$'\t' read -r k v; do
  [ -n "${k:-}" ] && CFG["$k"]="$v"
done < <(python3 - "$CONFIG" <<'PYEOF'
import json, sys
defaults = {
    "url": "", "fail_url": "",
    "db": "/home/bjorn/BirdNET-Pi/scripts/birds.db",
    "services": "birdengine,birdengine-recording,birdash,caddy",
    "max_detection_age_min": "0",
    "min_free_pct": "10",
    "fail_on_undervoltage": "false",
    "timeout_sec": "10",
}
user = {}
try:
    with open(sys.argv[1]) as fh:
        user = json.load(fh)
except FileNotFoundError:
    pass
except Exception as exc:
    print("__error__\t%s" % exc)
    user = {}
out = dict(defaults)
for key, val in (user or {}).items():
    if isinstance(val, list):
        val = ",".join(str(x) for x in val)
    elif isinstance(val, bool):
        val = "true" if val else "false"
    out[key] = str(val)
for key, val in out.items():
    print("%s\t%s" % (key, val.replace("\t", " ").replace("\n", " ")))
PYEOF
)

if [ -n "${CFG[__error__]:-}" ]; then
  log "FATAL: cannot parse $CONFIG: ${CFG[__error__]}"
  exit 1
fi

URL="${CFG[url]:-}"
FAIL_URL="${CFG[fail_url]:-}"
DB="${CFG[db]:-}"
SERVICES="${CFG[services]:-}"
MAX_DET_AGE="${CFG[max_detection_age_min]:-0}"
MIN_FREE_PCT="${CFG[min_free_pct]:-10}"
FAIL_ON_UV="${CFG[fail_on_undervoltage]:-false}"
TIMEOUT="${CFG[timeout_sec]:-10}"

# Layouts differ per host: BirdNET-Pi legacy (bird) vs birdash-only (mickey).
# An empty "db" means "go and find it".
if [ -z "$DB" ]; then
  for cand in "$HOME/BirdNET-Pi/scripts/birds.db" "$BIRDASH_DIR/data/birds.db" "$HOME/birdengine/birds.db"; do
    [ -r "$cand" ] || continue
    rows="$(sqlite3 -readonly -cmd '.timeout 2000' "$cand" 'SELECT COUNT(*) FROM detections;' 2>/dev/null || echo 0)"
    if [ "${rows:-0}" -gt 0 ]; then DB="$cand"; break; fi
  done
  [ -n "$DB" ] && log "auto-detected database: $DB"
fi

if [ -z "$URL" ]; then
  log "not configured — set \"url\" in $CONFIG (see README-deadman.md)"
  exit 0
fi
# healthchecks.io convention: the failure endpoint is the ping URL + /fail
[ -z "$FAIL_URL" ] && FAIL_URL="${URL%/}/fail"

# ── Checks ──────────────────────────────────────────────────────────────────
REASONS=""
REPORT=""
add_report() { REPORT="${REPORT}$1"$'\n'; }
add_fail()   { REASONS="${REASONS}$1; "; }

# 1. systemd services
svc_line=""
for svc in ${SERVICES//,/ }; do
  state="$(systemctl is-active "$svc" 2>/dev/null)"
  [ -z "$state" ] && state="unknown"
  svc_line="${svc_line}${svc}=${state} "
  [ "$state" = "active" ] || add_fail "service $svc is $state"
done
add_report "services : ${svc_line% }"

# 2. Most recent detection (read-only; must never block the engine's writes)
if [ -r "$DB" ]; then
  last="$(sqlite3 -readonly -cmd '.timeout 3000' "$DB" \
          "SELECT MAX(Date)||' '||MAX(Time) FROM detections WHERE Date=(SELECT MAX(Date) FROM detections);" 2>/dev/null)"
  if [ -n "$last" ] && [ "$last" != " " ]; then
    last_epoch="$(date -d "$last" +%s 2>/dev/null || echo 0)"
    if [ "$last_epoch" -gt 0 ]; then
      age_min=$(( ( $(date +%s) - last_epoch ) / 60 ))
      add_report "detection: $last (${age_min} min ago)"
      if [ "$MAX_DET_AGE" -gt 0 ] && [ "$age_min" -gt "$MAX_DET_AGE" ]; then
        add_fail "no detection for ${age_min} min (limit ${MAX_DET_AGE})"
      fi
    else
      add_report "detection: $last (unparseable timestamp)"
    fi
  else
    add_fail "database unreadable or empty"
    add_report "detection: QUERY FAILED"
  fi
else
  add_fail "database not readable at $DB"
  add_report "detection: DB MISSING ($DB)"
fi

# 3. Disk
used_pct="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
if [ -n "$used_pct" ]; then
  free_pct=$(( 100 - used_pct ))
  add_report "disk     : ${used_pct}% used, $(df -h --output=avail / 2>/dev/null | tail -1 | tr -d ' ') free"
  [ "$free_pct" -lt "$MIN_FREE_PCT" ] && add_fail "only ${free_pct}% disk free (limit ${MIN_FREE_PCT}%)"
fi

# 4. Power / thermal — under-voltage is the early warning a failing PSU gives.
if command -v vcgencmd >/dev/null 2>&1; then
  thr="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)"
  temp="$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)"
  if [ -n "$thr" ]; then
    tval=$(( thr ))
    uv_now=$(( tval & 0x1 ))
    uv_since=$(( (tval >> 16) & 0x1 ))
    note=""
    [ "$uv_since" -eq 1 ] && note=" UNDER-VOLTAGE since boot"
    [ "$uv_now" -eq 1 ]   && note=" UNDER-VOLTAGE NOW"
    add_report "power    : throttled=${thr} temp=${temp}${note}"
    if [ "$uv_now" -eq 1 ] && [ "$FAIL_ON_UV" = "true" ]; then
      add_fail "under-voltage detected (throttled=$thr)"
    fi
  fi
fi

# 5. Context that makes the next post-mortem trivial
add_report "host     : $(hostname) up since $(uptime -s 2>/dev/null), load$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null | sed 's/^/ /')"

# ── Ping ────────────────────────────────────────────────────────────────────
if [ -n "$REASONS" ]; then
  STATUS="FAIL"; TARGET="$FAIL_URL"
  BODY="BirdStation FAIL: ${REASONS%; }"$'\n\n'"$REPORT"
else
  STATUS="OK"; TARGET="$URL"
  BODY="BirdStation OK"$'\n\n'"$REPORT"
fi

if curl -fsS -m "$TIMEOUT" --retry 3 --retry-delay 2 --retry-connrefused \
        -X POST --data-binary "$BODY" "$TARGET" >/dev/null 2>&1; then
  log "$STATUS ping sent${REASONS:+ — ${REASONS%; }}"
  exit 0
else
  log "$STATUS ping FAILED to reach monitor (network down?)${REASONS:+ — ${REASONS%; }}"
  exit 1
fi
