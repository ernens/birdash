#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 008-caddy-api-compression
#
# /birds/api/* was served by reverse_proxy without an `encode` directive,
# so JSON responses (calendar/month, timeline, weather/range, query) went
# uncompressed. Static handles (/birds, /birds/audio) already had zstd+gzip.
# Measured ratio on /api/calendar/month: 11.6 KB → 2.0 KB (~5.9× smaller).
#
# Idempotent: checks if the encode directive is already present inside the
# /birds/api/* handle block.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="008-caddy-api-compression"
CADDYFILE="/etc/caddy/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
    echo "[migrate $NAME] $CADDYFILE not found — skipping"
    exit 0
fi

# Look for `encode` inside the /birds/api/* handle block.
# Use awk to scope the search to the right block.
if awk '/handle \/birds\/api\/\*/,/^\t}/' "$CADDYFILE" | grep -q "encode"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

sudo cp "$CADDYFILE" "$CADDYFILE.before-$NAME"
# Insert `encode zstd gzip` on the line just before `reverse_proxy localhost:7474`
sudo sed -i 's|reverse_proxy localhost:7474 {|encode zstd gzip\n\t\treverse_proxy localhost:7474 {|' "$CADDYFILE"

if sudo caddy validate --config "$CADDYFILE" 2>&1 | grep -q "Valid"; then
    sudo systemctl reload caddy
    echo "[migrate $NAME] added zstd+gzip on /birds/api/* + reloaded Caddy"
else
    sudo cp "$CADDYFILE.before-$NAME" "$CADDYFILE"
    echo "[migrate $NAME] validation failed — reverted"
    exit 1
fi
