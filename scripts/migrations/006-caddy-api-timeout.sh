#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 006-caddy-api-timeout
#
# Timeline and whats-new endpoints take 7-11s on Pi with 1M+ rows.
# Caddy's default proxy timeout (~5s) caused 502 Bad Gateway errors.
# This migration adds response_header_timeout 120s to the Caddyfile.
#
# Idempotent: checks if the timeout is already present.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="006-caddy-api-timeout"
CADDYFILE="/etc/caddy/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
    echo "[migrate $NAME] $CADDYFILE not found — skipping"
    exit 0
fi

if grep -q "response_header_timeout" "$CADDYFILE"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

# Insert the transport block after flush_interval -1
sudo cp "$CADDYFILE" "$CADDYFILE.before-$NAME"
sudo sed -i '/flush_interval -1/a\\t\t\ttransport http {\n\t\t\t\tresponse_header_timeout 120s\n\t\t\t}' "$CADDYFILE"

if sudo caddy validate --config "$CADDYFILE" 2>&1 | grep -q "Valid"; then
    sudo systemctl reload caddy
    echo "[migrate $NAME] added 120s API timeout + reloaded Caddy"
else
    sudo cp "$CADDYFILE.before-$NAME" "$CADDYFILE"
    echo "[migrate $NAME] validation failed — reverted"
    exit 1
fi
