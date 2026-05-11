#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 011-caddy-https-http2
#
# Enable HTTP/2 (and HTTP/3 / QUIC) by adding an :443 listener with
# tls internal. Caddy generates its own root CA and mints leaf certs on
# demand for any hostname the LAN accesses (bird.local, IPs, mDNS).
# HTTP/1.1 stays available on :80 for compatibility — browsers that
# don't trust the self-signed cert can keep using HTTP.
#
# HTTP/2 multiplexes the ~10 JS/CSS files we load per page over a single
# connection, eliminating head-of-line blocking that capped page-load
# parallelism at 6 connections under HTTP/1.1.
#
# First-visit caveat: the browser shows a cert warning because the
# internal CA isn't in the OS trust store. Users either click through
# once (browser remembers) or run `caddy trust` to install the root CA
# system-wide.
#
# Idempotent: detects the :443 block.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="011-caddy-https-http2"
CADDYFILE="/etc/caddy/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
    echo "[migrate $NAME] $CADDYFILE not found — skipping"
    exit 0
fi

if grep -q "^:443" "$CADDYFILE"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

sudo cp "$CADDYFILE" "$CADDYFILE.before-$NAME"

# Replace the entire Caddyfile with a snippet-based config that serves
# the same handles on both ports. This refactor is required to keep
# :80 and :443 in sync without duplicating handle blocks.
sudo tee "$CADDYFILE" > /dev/null <<'CADDYEOF'
{
	# Internal CA generates leaf certs on demand for any hostname —
	# LAN deployment, no public DNS, no Let's Encrypt.
	local_certs
	on_demand_tls {
		ask http://localhost:7474/api/health
	}
}

# Shared site config — reused by :80 (HTTP/1.1) and :443 (HTTP/2 + HTTP/3).
(birdash_site) {
	handle /birds/api/* {
		uri strip_prefix /birds
		encode zstd gzip
		reverse_proxy localhost:7474 {
			flush_interval -1
			transport http {
				response_header_timeout 120s
			}
		}
	}
	handle /birds/terminal/* {
		reverse_proxy localhost:7681
	}
	handle /birds/audio/* {
		encode zstd gzip
		uri strip_prefix /birds/audio
		root * /home/bjorn/BirdSongs/Extracted
		file_server
	}
	@vendor path /birds/js/chart.umd.min.js /birds/js/echarts.min.js /birds/js/vue.global.prod.min.js /birds/js/chart.* /birds/js/lucide* /birds/js/leaflet*
	handle @vendor {
		encode zstd gzip
		uri strip_prefix /birds
		root * /home/bjorn/birdash/public
		header Cache-Control "public, max-age=604800"
		file_server
	}
	handle /birds/i18n/* {
		encode zstd gzip
		uri strip_prefix /birds
		root * /home/bjorn/birdash/public
		header Cache-Control "public, max-age=3600"
		file_server
	}
	@birds path /birds /birds/*
	handle @birds {
		encode zstd gzip
		uri strip_prefix /birds
		root * /home/bjorn/birdash/public
		header Cache-Control "public, no-cache"
		file_server
	}
	redir / /birds/ permanent
}

:80 {
	import birdash_site
}

:443 {
	tls internal {
		on_demand
	}
	import birdash_site
}
CADDYEOF

if sudo caddy validate --config "$CADDYFILE" 2>&1 | grep -q "Valid"; then
    sudo systemctl reload caddy
    echo "[migrate $NAME] HTTPS:443 enabled with HTTP/2 + HTTP/3 + reloaded Caddy"
    echo "[migrate $NAME] First HTTPS visit shows a cert warning — click through"
    echo "[migrate $NAME] or run 'sudo caddy trust' to install the root CA."
else
    sudo cp "$CADDYFILE.before-$NAME" "$CADDYFILE"
    echo "[migrate $NAME] validation failed — reverted"
    exit 1
fi
