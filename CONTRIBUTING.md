# Contributing to Birdash

Thank you for your interest in contributing! 🐦

## Quick Start

### Prerequisites

- Raspberry Pi 5 with Raspberry Pi OS 64-bit
- Run `./install.sh` to set up all dependencies
- Node.js 18+, Python 3.11+, Caddy

### Local setup

```bash
git clone https://github.com/ernens/birdash.git
cd birdash
npm install
cp config/birdash-local.example.js public/js/birdash-local.js
# Edit birdash-local.js with your settings
node server/server.js
```

The API runs on `http://localhost:7474`.
The HTML pages are served by Caddy at `/birds/` (see README for Caddy setup).

### Tests

```bash
npm test
```

Backend tests verify security, API routes and SQL validation.

## How to contribute

### 1. Report a bug

Open an [Issue](https://github.com/ernens/birdash/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs observed behavior
- Screenshots if possible
- Environment (browser, OS, Node version)

### 2. Suggest a feature

Open an Issue with the `enhancement` label to discuss the idea before coding.

### 3. Submit code

1. **Fork** the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Code your changes
4. Verify tests pass: `npm test`
5. Commit: `git commit -m "Add: feature description"`
6. Push: `git push origin feature/my-feature`
7. Open a **Pull Request** to `main`

## Project Structure

```
birdash/
├── server/
│   ├── server.js              # HTTP server, middleware, route delegations
│   ├── lib/
│   │   ├── alerts.js          # Alert monitoring system
│   │   ├── config.js          # BirdNET config, validators, exec helper
│   │   └── db.js              # DB bootstrap, tables, taxonomy
│   └── routes/
│       ├── audio.js           # Audio devices, adaptive gain, streaming
│       ├── backup.js          # Backup config/schedule/export
│       ├── data.js            # Favorites, notes, photo-pref, query
│       ├── detections.js      # Detections, validations, flagging
│       ├── external.js        # BirdWeather, eBird, weather
│       ├── photos.js          # Photo resolution, species names/info
│       ├── settings.js        # Settings, apprise, alerts, logs SSE
│       ├── system.js          # Services, health, hardware, models
│       ├── timeline.js        # Timeline with SunCalc astronomy
│       └── whats-new.js       # Daily overview cards
├── tests/
│   └── server.test.js         # Backend tests
├── public/                    # Static files served by Caddy
│   ├── index.html             # Redirect to dashboard.html
│   ├── dashboard.html         # Bird Flow — live pipeline visualization
│   ├── overview.html          # Dashboard overview + weather widget
│   ├── today.html             # Today's detections
│   ├── recent.html            # Recent activity
│   ├── spectrogram.html       # Live spectrogram with audio filters
│   ├── recordings.html        # Best recordings with spectrograms
│   ├── detections.html        # Detection journal
│   ├── species.html           # Species detail card
│   ├── biodiversity.html      # Biodiversity matrix & heatmaps
│   ├── rarities.html          # Rare species tracker
│   ├── stats.html             # Statistics & rankings
│   ├── analyses.html          # Advanced multi-species analysis
│   ├── system.html            # System health (CPU, RAM, disk)
│   ├── settings.html          # Settings (10 lazy-loaded tabs)
│   ├── settings/              # Tab fragment HTML files
│   ├── log.html               # Live log dashboard (SSE)
│   ├── calendar.html          # Calendar/timeline view
│   ├── timeline.html          # Chronology view
│   ├── review.html            # Detection review
│   ├── gallery.html           # Best recordings + audio library
│   ├── favorites.html         # Favorites page
│   ├── weather.html           # Weather correlation
│   ├── models.html            # Model comparison
│   ├── js/
│   │   ├── bird-config.js     # Central configuration
│   │   ├── bird-shared.js     # Shared utilities (no Vue dependency)
│   │   ├── bird-vue-core.js   # Vue 3 composables, i18n, components
│   │   └── birdash-local.js   # Local config overrides (not versioned)
│   ├── i18n/                  # Translation JSON (fr/en/de/nl)
│   ├── css/
│   │   ├── bird-styles.css    # Global styles + 5 themes
│   │   └── bird-pages.css     # Page-specific styles
│   ├── img/                   # SVG assets
│   └── sw.js                  # Service Worker (offline cache)
├── scripts/
│   └── backup.sh              # Backup script (rsync incremental, multi-destination)
├── config/
│   ├── birdash.service        # systemd service unit
│   ├── birdash-local.example.js
│   └── backup.json            # Backup configuration (destination, schedule, content)
├── screenshots/
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── README.md                  # English (default)
├── README.fr.md               # Français
├── README.de.md               # Deutsch
└── README.nl.md               # Nederlands
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3 via CDN (no build step), Composition API |
| **Charts** | Chart.js (line/bar), ECharts (polar/heatmap) |
| **Audio** | Web Audio API (real-time filters: gain, highpass, lowpass, spectral subtraction) |
| **Backend** | Node.js HTTP (native `http` module), better-sqlite3 (read-only + dedicated write for deletions) |
| **Proxy** | Caddy with zstd/gzip compression |
| **Security** | Rate limiting, SQL validation, SRI, CORS, CSP headers |
| **i18n** | 4 UI languages (FR/EN/DE/NL) + 36 species name languages via BirdNET labels |
| **AI Models** | BirdNET V2.4, BirdNET V2.4+MData, Perch v2 (Google, 15K species) |

## Architecture Overview

```
Browser                    Raspberry Pi
┌──────────┐    Caddy     ┌──────────────────────────┐
│ Vue 3 +  │◄──/birds/──►│ /birds/api/* → server.js │
│ Chart.js │             │ /birds/audio/* → files   │
│ Web Audio│             │ /birds/* → public/       │
└──────────┘              │                          │
                          │ server.js (port 7474)    │
                          │   └─ birds.db (SQLite)   │
                          │                          │
                          │ BirdEngine (detection)   │
                          │   └─ BirdSongs/Extracted │
                          └──────────────────────────┘
```

## Code Conventions

### General

- **No build system** — files are served as-is
- **Vue 3 CDN** — no ES module imports, everything via `window.BIRDASH`
- **Indentation**: 2 spaces
- **Naming**: `camelCase` for JS, `kebab-case` for CSS classes

### File guidelines

| File | Purpose | Notes |
|------|---------|-------|
| `bird-config.js` | Configuration | Overridable via `birdash-local.js` |
| `bird-shared.js` | Pure utilities | No Vue dependency — framework-agnostic |
| `bird-vue-core.js` | Vue composables + i18n | Contains all translations inline |
| `bird-pages.css` | Page-specific styles | Organized by page with comments |
| `server/server.js` | HTTP entry point | Middleware, security, route delegations (208 lines) |
| `server/routes/*.js` | Route modules | Each handles a group of API endpoints via `handle(req, res, pathname, ctx)` |
| `server/lib/*.js` | Shared libraries | DB init, config parsing, alert system |
| `backup.sh` | Backup script | rsync incremental with progress tracking via JSON status file, supports 7 destination types |

### Commits

Short, descriptive messages in English:
- `Add:` new feature
- `Fix:` bug fix
- `Update:` enhancement to existing feature
- `Refactor:` restructuring without functional change

## Adding a New Language

All translations live in the `_TRANSLATIONS` object in `bird-vue-core.js`:

1. Copy an existing language block (e.g. `en: { ... }`)
2. Rename it (e.g. `es: { ... }`)
3. Fill `_meta: { lang:'es', label:'Español', flag:'🇪🇸' }`
4. Translate all keys (~200 keys)
5. The language automatically appears in the UI language selector

Species names are loaded from BirdNET label files (`/api/species-names?lang=xx`) — no action needed if BirdNET already supports the language.

## Adding a New Page

1. Create `public/my-page.html` — follow the pattern of existing pages
2. Add a navigation entry in `bird-config.js` → `pages` array
3. Add a translation key `nav_my_page` in all 4 language blocks
4. Add page-specific CSS in `bird-pages.css` (with a comment header)

## Audio DSP Features

The project includes client-side audio processing:

- **Real-time playback filters** (Web Audio API): Gain (dB), HighPass (Hz), LowPass (Hz)
- **Spectral subtraction** noise reduction with adjustable strength
- **Spectrogram rendering**: custom FFT (Cooley-Tukey), plasma colormap, 12 kHz max
- **Live spectrogram**: streaming PCM from server, real-time FFT→canvas

When working on audio features, keep in mind:
- All DSP runs client-side (no server processing)
- Use `BiquadFilterNode` for standard filters, custom FFT only for spectrograms
- The `useAudio()` composable in `bird-vue-core.js` handles lazy audio loading

## Contribution Ideas

Some areas where help is welcome:

- 🌍 **Translations**: add a language (ES, IT, PT…) in `bird-vue-core.js`
- 📊 **New charts**: seasonal trends, year-over-year comparisons
- 🗺️ **Map**: display nearby eBird observations on a map
- 📱 **Mobile**: improve responsive layout for phones
- 🎨 **Themes**: propose new color themes
- 🔔 **Notifications**: push alerts for rare species
- 📈 **Export**: CSV/PDF data export
- 🎵 **Audio**: advanced filters (notch, parametric EQ), waveform display
- 🧪 **Tests**: increase test coverage (frontend tests, E2E)
- 📖 **Documentation**: tutorials, API reference

## License

This project is licensed under [MIT](LICENSE). By contributing, you agree that your contributions are under the same license.

---

Questions? Open an Issue or start a Discussion. Happy birding! 🦉
