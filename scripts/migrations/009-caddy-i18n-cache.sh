#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 009-caddy-i18n-cache
#
# i18n JSON files (~1 KB compressed each, four locales) were served with
# the same `Cache-Control: public, no-cache` as the rest of /birds. That
# triggered a conditional GET (304) on every locale on every page load —
# 4 round-trips per page × ~33 pages of navigation = 130 useless 304s
# per session. They change once a release at most.
#
# Adds a dedicated handle for /birds/i18n/* with Cache-Control:
# public, max-age=3600. Browser hard-caches for an hour, no revalidation.
# A new locale string only shows up after the cache expires or the user
# does a hard reload — acceptable trade-off (we still bump the SW cache
# name on every release, which forces the i18n re-fetch on update).
#
# Idempotent: checks if the /birds/i18n/* handle is already present.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="009-caddy-i18n-cache"
CADDYFILE="/etc/caddy/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
    echo "[migrate $NAME] $CADDYFILE not found — skipping"
    exit 0
fi

if grep -q "handle /birds/i18n/\*" "$CADDYFILE"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

# Detect the user's home from the existing Caddyfile so this migration
# works on any Pi regardless of user name (bird, mickey, biloute…).
# Origin: same hardcoded /home/bjorn/ pattern that broke mickey via
# migration 011 v1 (see commit e443422).
DETECTED_HOME=$(grep -oE 'root \* /home/[^/]+' "$CADDYFILE" | head -1 | awk '{print $3}')
if [ -z "$DETECTED_HOME" ]; then DETECTED_HOME="$HOME"; fi

sudo cp "$CADDYFILE" "$CADDYFILE.before-$NAME"

# Insert the new /birds/i18n/* handle BEFORE the catch-all @birds block.
# The catch-all matches /birds/* including /birds/i18n/*, so a more
# specific block must come first.
sudo python3 - "$CADDYFILE" "$DETECTED_HOME" <<'PYEOF'
import sys, re
path, home = sys.argv[1], sys.argv[2]
with open(path) as f: txt = f.read()
block = f"""\thandle /birds/i18n/* {{
\t\tencode zstd gzip
\t\turi strip_prefix /birds
\t\troot * {home}/birdash/public
\t\theader Cache-Control "public, max-age=3600"
\t\tfile_server
\t}}
"""
# Insert just before the @birds matcher.
txt2 = re.sub(r'(\n\t@birds path /birds /birds/\*)', '\n' + block + r'\1', txt)
if txt == txt2:
    raise SystemExit("could not locate @birds anchor — aborting")
with open(path, 'w') as f: f.write(txt2)
PYEOF

if sudo caddy validate --config "$CADDYFILE" 2>&1 | grep -q "Valid"; then
    sudo systemctl reload caddy
    echo "[migrate $NAME] added 1h cache on /birds/i18n/* + reloaded Caddy"
else
    sudo cp "$CADDYFILE.before-$NAME" "$CADDYFILE"
    echo "[migrate $NAME] validation failed — reverted"
    exit 1
fi
