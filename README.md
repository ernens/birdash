# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Replaces [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) with a faster, dual-model architecture.

> [Francais](README.fr.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Screenshots

| Dashboard | Species Detail |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Recordings | Detections |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Spectrogram | Statistics |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Architecture

```
Raspberry Pi 5 + SSD
├── RODE AI-Micro (USB)
│     ↓
├── BirdEngine (Python)
│   ├── Recording service (arecord → WAV 45s)
│   ├── BirdNET V2.4    (~2s/file, primary)
│   ├── Perch V2 INT8   (~12s/file, secondary)
│   ├── MP3 extraction + spectrograms
│   ├── BirdWeather upload
│   └── Smart notifications (ntfy.sh)
│
├── Birdash (Node.js)
│   ├── Dashboard API (port 7474)
│   ├── Live spectrogram (PCM + MP3 stream)
│   ├── Audio config module
│   ├── Detection review + auto-flagging
│   └── Model comparison
│
├── Caddy (reverse proxy :80)
├── ttyd (web terminal)
└── SQLite (1M+ detections)
```

## Features

### Detection Engine (BirdEngine)
- 🤖 **Dual-model inference** — BirdNET V2.4 (fast, ~2s) + Perch V2 INT8 (precise, ~12s) in parallel
- 🎙️ **Local recording** — RODE AI-Micro via ALSA with configurable gain
- 📡 **BirdWeather** — automatic upload of soundscapes + detections
- 🔔 **Smart notifications** — ntfy.sh alerts for rare species, first-of-season, new species (not every sparrow)
- ⚡ **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard
- 📊 Real-time overview with KPIs, charts, morning summary
- 🎵 **Live spectrogram** — real-time audio from mic with bird name overlay
- 🎧 Detection feed with integrated audio playback
- 🦜 Species cards with photos (iNaturalist + Wikipedia), IUCN status
- 🧬 Biodiversity matrix, Shannon index, taxonomy breakdown
- 💎 Rare species tracking
- 📈 Statistics and rankings
- 🏆 Best recordings gallery
- 🔬 Advanced analyses (polar charts, heatmaps, time series)

### Model Comparison
- 🤖 **Side-by-side** — detections per model, species coverage, confidence
- 📊 **Daily chart** — detection trends per model over time
- 🎯 **Exclusive species** — what each model catches that the other misses
- 📋 **Overlap table** — shared species with detection ratio

### Detection Review
- 🔍 **Auto-flagging** — nocturnal birds by day, out-of-season migrants, low confidence isolates, non-European species
- ✅ **Bulk actions** — confirm/reject by rule ("reject all owls detected during daytime")
- 🎵 Audio playback per detection for manual verification

### Audio Configuration
- 🎙️ Device detection and selection (RODE AI-Micro auto-highlighted)
- 🎛️ 6 environment profiles (garden, forest, roadside, urban, night, test)
- ⚖️ Inter-channel calibration wizard for dual EM272 microphones
- 📊 Real-time VU meters via SSE

### Settings & System
- 🔧 Full settings UI — models, analysis parameters, notifications, audio, backup
- 🖥️ System health — CPU, RAM, disk, temperature, services
- 💻 **Web terminal** — full bash in browser, supports Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV with scheduling
- 🎨 5 themes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 UI languages (FR/EN/NL/DE) + 36 languages for species names

## Quantized Model

We publish the first **Perch V2 INT8** quantized model for edge deployment:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** on HuggingFace

~30% faster on Raspberry Pi 5 with identical species coverage (14,795 classes).

## Hardware

| Component | Recommended |
|-----------|-------------|
| SBC | Raspberry Pi 5 (8GB) |
| Storage | NVMe SSD (500GB+) |
| Audio | RODE AI-Micro + 2x Clippy EM272 |
| Network | Ethernet or WiFi |

## Prerequisites

- Raspberry Pi 5 with Raspberry Pi OS (64-bit)
- Node.js >= 18
- Python 3.11+ with venv
- ffmpeg
- Caddy (reverse proxy)

## Installation

```bash
# 1. Clone
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
npm install

# 2. Configure
cp config/birdash-local.example.js public/js/birdash-local.js
nano public/js/birdash-local.js  # Set location, API keys

# 3. Install BirdEngine
cd ~/birdengine
python3 -m venv venv
venv/bin/pip install ai-edge-litert numpy soundfile resampy toml watchdog
# Copy models to ~/birdengine/models/

# 4. Install services
sudo cp ~/birdash/config/birdash.service /etc/systemd/system/
sudo cp ~/birdengine/birdengine.service /etc/systemd/system/
sudo cp ~/birdengine/birdengine-recording.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now birdengine-recording birdengine birdash caddy

# 5. Configure Caddy (see below)
```

## Caddy Configuration

```
:80 {
    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy localhost:7474 {
            flush_interval -1
        }
    }
    handle /birds/terminal/* {
        reverse_proxy localhost:7681
    }
    handle /birds/audio/* {
        encode zstd gzip
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }
    handle /birds* {
        encode zstd gzip
        uri strip_prefix /birds
        root * /home/{USER}/birdash/public
        file_server
    }
    redir / /birds/ permanent
}
```

## Project Structure

```
birdash/                           # Dashboard (Node.js)
├── server/server.js               # API backend (~3500 lines)
├── public/                        # Static frontend
│   ├── *.html                     # 15 pages
│   ├── js/                        # Vue 3 composables, config, shared utils
│   ├── css/                       # Styles + 5 themes
│   └── sw.js                      # Service Worker
├── config/
│   ├── audio_config.json          # Audio device config
│   ├── audio_profiles.json        # Environment profiles
│   ├── detection_rules.json       # Auto-flagging rules
│   └── birdash.service            # systemd service
├── scripts/backup.sh              # Incremental backup (rsync)
└── tests/server.test.js

birdengine/                        # Detection engine (Python)
├── engine.py                      # Main engine (~1100 lines)
├── config.toml                    # Engine configuration
├── record.sh                      # Audio capture script
├── purge_audio.sh                 # Disk management
├── models/                        # TFLite models
│   ├── BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite
│   ├── Perch_v2.tflite
│   ├── Perch_v2_int8.tflite
│   └── *_Labels.txt, l18n/
├── birdengine.service             # systemd service
├── birdengine-recording.service   # systemd recording service
└── ttyd.service                   # Web terminal service
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BIRDASH_PORT` | `7474` | API server port |
| `BIRDASH_DB` | `~/BirdNET-Pi/scripts/birds.db` | SQLite database path |
| `EBIRD_API_KEY` | — | eBird API key (optional) |
| `BW_STATION_ID` | — | BirdWeather station ID (optional) |

## Security

- Rate limiting: 120 req/min per IP
- Strict SQL validation (read-only, parameterized)
- Security headers (CSP, X-Frame-Options, Referrer-Policy)
- CORS restricted to localhost
- SRI on CDN scripts

## License

[MIT](LICENSE)
