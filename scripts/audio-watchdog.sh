#!/usr/bin/env bash
#
# audio-watchdog.sh — Liveness watchdog for the capture chain, with tiered recovery.
#
# alerts.js already flags a mic that is too quiet or too loud, but it
# deliberately stays quiet once the readings go stale. Its own comment says:
#
#   "If the engine hasn't written a reading in 2x the sustained window, we
#    skip — the service-down alert already covers engine offline"
#
# That leaves one failure uncovered: birdengine-recording.service sitting
# `active` while arecord produces nothing — a re-enumerated USB mic, a
# vanished ALSA device (this host already logs `cannot get freq at ep 0x82`
# for the RØDE). systemd sees a live process so service-down never fires,
# the readings are stale so the sound alert skips, and the station records
# silence until a human happens to notice.
#
# So this watchdog watches what arecord actually produces — the mtime of the
# newest WAV in the incoming directory — rather than anything downstream of
# it, and escalates:
#
#   level 1   restart the recording service
#   level 2   restart the engine as well
#   level 3+  stop restarting, keep notifying — never loop on a dead mic
#
# Config: config/audio-watchdog.json    State: config/audio-watchdog.state.json
# Run by: birdash-audio-watchdog.timer (every 2 min)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIRDASH_DIR="${BIRDASH_DIR:-$(dirname "$SCRIPT_DIR")}"
HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"
CONFIG="$BIRDASH_DIR/config/audio-watchdog.json"
STATE="$BIRDASH_DIR/config/audio-watchdog.state.json"
LOG="$BIRDASH_DIR/config/audio-watchdog.log"
LOCKFILE="/run/lock/birdash-audio-watchdog.lock"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null; }

if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  tail -c 131072 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

exec 9>"$LOCKFILE" 2>/dev/null || true
flock -n 9 2>/dev/null || { log "skip: run already in progress"; exit 0; }

# ── Config ──────────────────────────────────────────────────────────────────
declare -A CFG=()
while IFS=$'\t' read -r k v; do
  [ -n "${k:-}" ] && CFG["$k"]="$v"
done < <(python3 - "$CONFIG" <<'PYEOF'
import json, sys
defaults = {
    "enabled": "true",
    "incoming_dir": "",
    "stall_sec": "300",
    "restart_grace_sec": "180",
    "max_restarts_per_hour": "3",
    "recording_service": "birdengine-recording",
    "engine_service": "birdengine",
    "notify": "true",
}
user = {}
try:
    with open(sys.argv[1]) as fh:
        user = json.load(fh)
except FileNotFoundError:
    pass
except Exception as exc:
    print("__error__\t%s" % exc)
out = dict(defaults)
for key, val in (user or {}).items():
    if isinstance(val, bool):
        val = "true" if val else "false"
    out[key] = str(val)
for key, val in out.items():
    print("%s\t%s" % (key, str(val).replace("\t", " ").replace("\n", " ")))
PYEOF
)

if [ -n "${CFG[__error__]:-}" ]; then
  log "FATAL: cannot parse $CONFIG: ${CFG[__error__]}"
  exit 1
fi

[ "${CFG[enabled]:-true}" = "true" ] || { log "disabled in $CONFIG"; exit 0; }

INCOMING="${CFG[incoming_dir]:-}"
STALL_SEC="${CFG[stall_sec]:-300}"
GRACE_SEC="${CFG[restart_grace_sec]:-180}"
MAX_RESTARTS="${CFG[max_restarts_per_hour]:-3}"
REC_SVC="${CFG[recording_service]:-birdengine-recording}"
ENG_SVC="${CFG[engine_service]:-birdengine}"
NOTIFY="${CFG[notify]:-true}"

# Layouts differ per host, same as the dead-man switch.
if [ -z "$INCOMING" ]; then
  for cand in "$HOME/birdengine/audio/incoming" "$BIRDASH_DIR/engine/audio/incoming"; do
    [ -d "$cand" ] && { INCOMING="$cand"; break; }
  done
fi
if [ -z "$INCOMING" ] || [ ! -d "$INCOMING" ]; then
  log "FATAL: incoming directory not found (set \"incoming_dir\" in $CONFIG)"
  exit 1
fi

# ── State ───────────────────────────────────────────────────────────────────
NOW="$(date +%s)"
read -r LEVEL LAST_RESTART RESTARTS BACKOFF_NOTIFIED < <(python3 - "$STATE" "$NOW" <<'PYEOF'
import json, sys
now = int(sys.argv[2])
try:
    with open(sys.argv[1]) as fh:
        s = json.load(fh)
except Exception:
    s = {}
# Only restarts inside the trailing hour count toward the rate limit.
restarts = [int(t) for t in s.get("restarts", []) if now - int(t) < 3600]
print(int(s.get("level", 0)),
      int(s.get("last_restart", 0)),
      ",".join(str(t) for t in restarts) or "-",
      "true" if s.get("backoff_notified") else "false")
PYEOF
)
[ "$RESTARTS" = "-" ] && RESTARTS=""
RESTART_COUNT=0
[ -n "$RESTARTS" ] && RESTART_COUNT="$(printf '%s' "$RESTARTS" | tr ',' '\n' | grep -c .)"

save_state() {
  python3 - "$STATE" "$1" "$2" "$3" "$4" <<'PYEOF'
import json, sys
path, level, last_restart, restarts, backoff = sys.argv[1:6]
data = {
    "level": int(level),
    "last_restart": int(last_restart),
    "restarts": [int(t) for t in restarts.split(",") if t],
    "backoff_notified": backoff == "true",
}
with open(path, "w") as fh:
    json.dump(data, fh, indent=2)
PYEOF
}

notify() {
  [ "$NOTIFY" = "true" ] || return 0
  local title="$1" body="$2" conf="$BIRDASH_DIR/config/apprise.txt" bin=""
  [ -s "$conf" ] || return 0
  for cand in "$BIRDASH_DIR/engine/venv/bin/apprise" "$HOME/birdengine/venv/bin/apprise" \
              /usr/local/bin/apprise /usr/bin/apprise; do
    [ -x "$cand" ] && { bin="$cand"; break; }
  done
  [ -n "$bin" ] || { log "apprise binary not found — notification skipped"; return 0; }
  timeout 20 "$bin" -t "$title" -b "$body" "--config=$conf" >/dev/null 2>&1 \
    || log "apprise delivery failed"
}

# ── Liveness ────────────────────────────────────────────────────────────────
NEWEST="$(find "$INCOMING" -maxdepth 1 -name '*.wav' -printf '%T@ %p\n' 2>/dev/null \
          | sort -rn | head -1)"
if [ -z "$NEWEST" ]; then
  AGE=999999
  NEWEST_NAME="(aucun wav)"
else
  NEWEST_NAME="$(basename "${NEWEST#* }")"
  AGE=$(( NOW - ${NEWEST%%.*} ))
fi

# ── Healthy ─────────────────────────────────────────────────────────────────
if [ "$AGE" -lt "$STALL_SEC" ]; then
  if [ "$LEVEL" -gt 0 ]; then
    log "RECOVERED — audio flowing again (${AGE}s old: $NEWEST_NAME) after level $LEVEL"
    notify "BirdStation — capture audio rétablie" \
"La capture audio a repris après $LEVEL redémarrage(s) automatique(s).

Dernier fichier : $NEWEST_NAME (il y a ${AGE}s)
Hôte : $(hostname)"
  fi
  save_state 0 "$LAST_RESTART" "$RESTARTS" false
  exit 0
fi

# ── Stalled ─────────────────────────────────────────────────────────────────
SINCE_RESTART=$(( NOW - LAST_RESTART ))
if [ "$LAST_RESTART" -gt 0 ] && [ "$SINCE_RESTART" -lt "$GRACE_SEC" ]; then
  log "stalled (${AGE}s) but within restart grace (${SINCE_RESTART}s < ${GRACE_SEC}s) — waiting"
  exit 0
fi

if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS" ]; then
  log "stalled (${AGE}s) — backing off, $RESTART_COUNT restarts in the last hour (limit $MAX_RESTARTS)"
  if [ "$BACKOFF_NOTIFIED" != "true" ]; then
    notify "BirdStation — capture audio HS, intervention requise" \
"Aucun fichier audio depuis ${AGE}s, et $RESTART_COUNT redémarrages automatiques n'ont rien changé.

Le watchdog cesse de redémarrer pour ne pas boucler.
Vérifier le micro USB et « dmesg | tail ».

Dernier fichier : $NEWEST_NAME
Hôte : $(hostname)"
    save_state "$LEVEL" "$LAST_RESTART" "$RESTARTS" true
  fi
  exit 1
fi

LEVEL=$(( LEVEL + 1 ))
log "STALL detected — no audio for ${AGE}s (last: $NEWEST_NAME) — escalating to level $LEVEL"

if sudo -n systemctl restart "$REC_SVC" 2>/dev/null; then
  ACTION="redémarrage de $REC_SVC"
else
  ACTION="ÉCHEC du redémarrage de $REC_SVC"
  log "  failed to restart $REC_SVC"
fi

if [ "$LEVEL" -ge 2 ]; then
  if sudo -n systemctl restart "$ENG_SVC" 2>/dev/null; then
    ACTION="$ACTION + $ENG_SVC"
  else
    # The notification is the user-facing record of what was attempted, so an
    # attempted-but-failed restart has to appear in it, not only in the log.
    ACTION="$ACTION + ÉCHEC sur $ENG_SVC"
    log "  failed to restart $ENG_SVC"
  fi
fi

log "  action: $ACTION"
notify "BirdStation — capture audio bloquée (niveau $LEVEL)" \
"Aucun nouveau fichier audio depuis ${AGE}s alors que le service tourne.

Action : $ACTION
Dernier fichier : $NEWEST_NAME
Hôte : $(hostname)"

RESTARTS="${RESTARTS:+$RESTARTS,}$NOW"
save_state "$LEVEL" "$NOW" "$RESTARTS" false
exit 0
