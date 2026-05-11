#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 010-caddy-vendor-cache
#
# Vendor libs (vue.global.prod.min.js, chart.umd.min.js, echarts.min.js,
# lucide*, leaflet*, chart.*) totalled ~1.3 MB and shared the catch-all
# /birds handle's Cache-Control: public, no-cache directive. That forces
# a conditional GET (304) on every page load — about 250 ms of round-trips
# on slow networks before the page can even start drawing.
#
# These files change at most once per release. New handle in front of the
# catch-all serves them with Cache-Control: public, max-age=604800
# (7 days). The service-worker cache-name bump on every release already
# triggers a fresh re-fetch when the libs actually change.
#
# Idempotent: detects the @vendor matcher.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="010-caddy-vendor-cache"
CADDYFILE="/etc/caddy/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
    echo "[migrate $NAME] $CADDYFILE not found — skipping"
    exit 0
fi

if grep -q "@vendor path /birds/js/" "$CADDYFILE"; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

sudo cp "$CADDYFILE" "$CADDYFILE.before-$NAME"

# Insert before the @birds catch-all (more-specific must come first).
sudo python3 - "$CADDYFILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
with open(path) as f: txt = f.read()
block = """\t# Vendor libraries: 3rd-party, change at most once per release.
\t# 7-day hard cache — service-worker cache-name bump on each release
\t# forces re-fetch via the SW, and a manual ctrl-shift-R bypasses
\t# both caches if the user really needs to.
\t@vendor path /birds/js/chart.umd.min.js /birds/js/echarts.min.js /birds/js/vue.global.prod.min.js /birds/js/chart.* /birds/js/lucide* /birds/js/leaflet*
\thandle @vendor {
\t\tencode zstd gzip
\t\turi strip_prefix /birds
\t\troot * /home/bjorn/birdash/public
\t\theader Cache-Control "public, max-age=604800"
\t\tfile_server
\t}
"""
txt2 = re.sub(r'(\n\t@birds path /birds /birds/\*)', '\n' + block + r'\1', txt)
if txt == txt2:
    raise SystemExit("could not locate @birds anchor — aborting")
with open(path, 'w') as f: f.write(txt2)
PYEOF

if sudo caddy validate --config "$CADDYFILE" 2>&1 | grep -q "Valid"; then
    sudo systemctl reload caddy
    echo "[migrate $NAME] added 7d cache on vendor JS + reloaded Caddy"
else
    sudo cp "$CADDYFILE.before-$NAME" "$CADDYFILE"
    echo "[migrate $NAME] validation failed — reverted"
    exit 1
fi
