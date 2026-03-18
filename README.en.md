# 🐦 BirdBoard

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern ornithological dashboard for [BirdNET-Pi](https://github.com/mcguirepr89/BirdNET-Pi).
Vue 3 (CDN) frontend with Node.js backend, multilingual (FR/EN/NL).

> [Version française](README.md) · [Contributing](CONTRIBUTING.md)

## Screenshots

| Dashboard | Species Detail |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Recordings | Detections |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversity | Rarities |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spectrogram | Statistics |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Features

- 📊 Real-time overview with KPIs and charts
- 🎙️ Detection feed with integrated audio playback
- 🦜 Detailed species cards with photo carousel (iNaturalist + Wikipedia)
- 🧬 Taxonomy info, IUCN conservation status, wingspan
- 🗓️ Biodiversity matrix (hours × species)
- 💎 Rare species and alerts
- 📈 Statistics and rankings
- 🎵 Audio spectrogram with DSP noise reduction
- 🏆 Best recordings with player
- 🖥️ System status (CPU, RAM, disk, temperature)
- 🔬 Advanced analyses
- ⚡ Service Worker for offline caching
- ♿ Accessibility (WCAG AA, keyboard navigation, skip-link)
- 🎨 5 visual themes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 3 languages (FR / EN / NL)

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

# 3. Local configuration
cp pibird-local.example.js pibird-local.js
nano pibird-local.js

# 4. Test the server
node bird-server.js
# -> [PIBIRD] API started on http://127.0.0.1:7474

# 5. Run tests
npm test

# 6. Install systemd service
sudo cp pibird-api.service /etc/systemd/system/
sudo systemctl edit pibird-api
#    [Service]
#    Environment=EBIRD_API_KEY=your_key
#    Environment=BW_STATION_ID=your_station
sudo systemctl daemon-reload
sudo systemctl enable pibird-api
sudo systemctl start pibird-api
```

## Caddy Configuration

BirdBoard uses Caddy as a reverse proxy to serve the API, audio files,
and static pages under a single `/birds/` path.

```
YOUR_HOSTNAME {
    encode zstd gzip

    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy 127.0.0.1:7474
    }

    handle /birds/audio/* {
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }

    handle /birds* {
        root * /home/{USER}/pibird
        file_server
    }
}
```

Replace `{USER}` with your system username.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Project Structure

```
BirdBoard/
├── bird-server.js           # Node.js HTTP backend (API + SQLite)
├── bird-server.test.js      # Backend tests (19 tests)
├── bird-config.js           # Central configuration
├── bird-vue-core.js         # Vue 3 composables (PibirdShell, i18n, themes)
├── bird-styles.css          # Global styles + 5 themes
├── bird-pages.css           # Page-specific styles
├── sw.js                    # Service Worker (offline cache)
├── pibird-local.example.js  # Local config template
├── pibird-api.service       # systemd service
├── index.html               # Main dashboard
├── species.html             # Species detail (carousel, stats, charts)
├── recordings.html          # Best recordings
├── detections.html          # Detection journal
├── biodiversity.html        # Biodiversity matrix
├── rarities.html            # Rare species
├── stats.html               # Statistics
├── analyses.html            # Advanced analyses
├── spectrogram.html         # Audio spectrogram
├── today.html               # Today's detections
├── recent.html              # Recent detections
├── system.html              # System status
├── screenshots/             # Application screenshots
├── CONTRIBUTING.md          # Contribution guide
└── LICENSE                  # MIT License
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PIBIRD_PORT` | `7474` | API server port |
| `PIBIRD_DB` | `~/BirdNET-Pi/scripts/birds.db` | SQLite database path |
| `EBIRD_API_KEY` | — | eBird API key (optional) |
| `BW_STATION_ID` | — | BirdWeather station ID (optional) |

## Security

- 🛡️ Rate limiting: 120 requests/min per IP
- 🔒 Strict SQL validation (read-only, no multi-statements)
- 🔐 Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- 🌐 CORS restricted to configured origins
- ✅ SRI (Subresource Integrity) on CDN scripts
- 🧹 XSS protection (HTML escaping)
- 🙈 SQL error details masked in API responses

## Contributing

Contributions are welcome! See the [contribution guide](CONTRIBUTING.md).

## Updating

```bash
cd ~/pibird
git pull
npm install
sudo systemctl restart pibird-api
```

## License

[MIT](LICENSE) © ernens
