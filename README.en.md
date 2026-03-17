# BirdBoard

Modern ornithological dashboard for [BirdNET-Pi](https://github.com/mcguirepr89/BirdNET-Pi).
Vue 3 (CDN) frontend with Node.js backend, multilingual (FR/EN/NL).

> [Version francaise](README.md)

## Features

- Overview with real-time KPIs and charts
- Detection feed with integrated audio playback
- Detailed species cards with photos (iNaturalist)
- Biodiversity matrix (hours x species)
- Rare species and alerts
- Statistics and rankings
- Audio spectrogram
- Recent recordings with player
- System status (CPU, RAM, disk, temperature)
- Advanced analyses
- Service Worker for offline caching
- Accessibility (WCAG AA, keyboard navigation, skip-link)

## Prerequisites

- BirdNET-Pi running (`~/BirdNET-Pi/scripts/birds.db` present)
- Node.js >= 18 (`node --version`)
- Caddy (see Caddy Configuration section below)

## Installation

```bash
# 1. Clone the repository
cd ~
git clone https://github.com/ernens/BirdBoard.git pibird

# 2. Install dependencies
cd ~/pibird
npm install

# 3. Edit configuration
#    Edit bird-config.js for your setup:
#    - location (coordinates, name)
#    - defaultLang (fr, en or nl)
nano bird-config.js

# 4. Local configuration (optional)
#    Copy the template and fill in your API keys
cp pibird-local.example.js pibird-local.js
nano pibird-local.js

# 5. Test the server manually
node bird-server.js
# -> [PIBIRD] API demarree sur http://127.0.0.1:7474
# Test: curl http://127.0.0.1:7474/api/health

# 6. Run tests
npm test

# 7. Install the systemd service
sudo cp pibird-api.service /etc/systemd/system/
#    Edit the service to add your API keys (EBIRD_API_KEY, BW_STATION_ID)
sudo systemctl edit pibird-api
sudo systemctl daemon-reload
sudo systemctl enable pibird-api
sudo systemctl start pibird-api
sudo systemctl status pibird-api
```

## Caddy Configuration

BirdBoard uses Caddy as a reverse proxy to serve the API, audio files,
and static pages under a single `/birds/` path.

### 1. Install Caddy (if not already installed)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. Configure the Caddyfile

Edit `/etc/caddy/Caddyfile` and add the BirdBoard block to your site
configuration. Replace `YOUR_HOSTNAME` with your machine's hostname
(e.g., `raspberrypi.local`, `mypi.local`, or an IP address).

```
YOUR_HOSTNAME {
    encode zstd gzip

    # ── BirdBoard ──────────────────────────────────────

    # API: proxy to the Node.js backend
    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy 127.0.0.1:7474
    }

    # Audio: serve audio files extracted by BirdNET-Pi
    handle /birds/audio/* {
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }

    # Static dashboard pages
    handle /birds* {
        root * /home/{USER}/pibird
        file_server
        try_files {path} /birds/index.html
    }

    # ... your other configurations ...
}
```

Replace `{USER}` with your system username (e.g., `pi`, `bjorn`).

### 3. Apply the configuration

```bash
# Validate syntax
caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy
```

## Verification

```bash
# Test the API
curl http://127.0.0.1:7474/api/health

# Run backend tests (19 tests)
npm test

# Open the dashboard in a browser
# http://YOUR_HOSTNAME/birds/
```

## File Structure

```
~/pibird/
├── bird-server.js           # Node.js native HTTP backend (port 7474)
├── bird-server.test.js      # Backend tests (19 tests, Node test runner)
├── bird-config.js           # Configuration (location, language, thresholds)
├── bird-i18n.js             # Translations (fr/en/nl)
├── bird-core.js             # Shared utilities (fetch, formatting)
├── bird-vue-core.js         # Vue 3 components (PibirdShell, escHtml)
├── bird-styles.css          # Global visual theme (light/dark/paper)
├── bird-pages.css           # Page-specific styles
├── sw.js                    # Service Worker (offline caching)
├── favicon.svg              # Site icon
├── robin-logo.svg           # BirdBoard logo
├── fr.json / en.json / nl.json  # Translation files
│
├── index.html               # Overview
├── today.html               # Today's detections
├── recent.html              # Recent detections
├── detections.html          # Detection feed + audio
├── recordings.html          # Recordings
├── species.html             # Species card
├── biodiversity.html        # Biodiversity matrix
├── rarities.html            # Rare species
├── spectrogram.html         # Spectrogram
├── stats.html               # Statistics
├── analyses.html            # Advanced analyses
├── system.html              # System status
│
├── aujourd-hui.html         # Today (FR)
├── especes.html             # Species card (FR)
├── biodiversite.html        # Biodiversity matrix (FR)
├── rarites.html             # Rare species (FR)
├── systeme.html             # System status (FR)
│
├── pibird-api.service       # systemd service
├── pibird-local.example.js  # Local config template (API keys)
├── caddy-snippet.txt        # Caddy config snippet
├── package.json             # Dependencies and npm scripts
└── PATCH-config-nav.txt     # Patch notes
```

## Environment Variables

```bash
# Required (in pibird-api.service or shell)
PIBIRD_PORT=7474
PIBIRD_DB=/home/{USER}/BirdNET-Pi/scripts/birds.db

# Optional (in pibird-local.js or systemd override)
EBIRD_API_KEY=your_ebird_api_key
BW_STATION_ID=your_birdweather_station_id
```

## Security

- Rate limiting: 120 requests/min per IP
- Strict SQL validation (read-only, no multi-statements)
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- CORS restricted to configured origins
- SRI (Subresource Integrity) on CDN scripts
- XSS protection (HTML escaping)
- SQL error details masked in API responses

## Updating

```bash
cd ~/pibird
git pull
npm install
# Restart the service if bird-server.js changed
sudo systemctl restart pibird-api
```

## License

MIT
