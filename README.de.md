# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modernes Vogelerkennungs-Dashboard und Engine fur Raspberry Pi 5. Eigenstandige Dual-Modell-Architektur mit BirdNET V2.4 + Perch V2. Anpassbarer Stationsname und Branding.

> [English](README.md) | [Francais](README.fr.md) | [Nederlands](README.nl.md)

## Screenshots

<details>
<summary><b>Live</b> — Dashboard · Heute · Spektrogramm</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/today.png"       width="240" alt="Heute">
  <img src="screenshots/spectrogram.png" width="240" alt="Spektrogramm">
</p>
</details>

<details>
<summary><b>Verlauf</b> — Kalender · Timeline · Erkennungen · Prüfung</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Kalender">
  <img src="screenshots/timeline.png"   width="240" alt="Timeline">
  <img src="screenshots/detections.png" width="240" alt="Erkennungen">
  <img src="screenshots/review.png"     width="240" alt="Prüfung">
</p>
</details>

<details>
<summary><b>Arten</b> — Art · Aufnahmen · Galerie · Seltenheiten</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Art">
  <img src="screenshots/recordings.png" width="240" alt="Aufnahmen">
  <img src="screenshots/gallery.png"    width="240" alt="Galerie">
  <img src="screenshots/rarities.png"   width="240" alt="Seltenheiten">
</p>
</details>

<details>
<summary><b>Auswertungen</b> — Wetter · Statistiken · Analysen · Biodiversität · Phänologie</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Wetter">
  <img src="screenshots/stats.png"        width="240" alt="Statistiken">
  <img src="screenshots/analyses.png"     width="240" alt="Analysen">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversität">
  <img src="screenshots/phenology.png"    width="240" alt="Phänologie">
</p>
</details>

<details>
<summary><b>Station</b> — Systemzustand, Einstellungen &amp; Terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Systemzustand">
  <img src="screenshots/system-model.png"    width="240" alt="Modellmonitor">
  <img src="screenshots/system-data.png"     width="240" alt="Systemdaten">
  <img src="screenshots/system-external.png" width="240" alt="Extern">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Erkennung">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Benachrichtigungen">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Dienste">
  <img src="screenshots/settings-species.png"  width="240" alt="Arten">
  <img src="screenshots/settings-backup.png"   width="240" alt="Backup">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Funktionen

- 🤖 **Dual-Modell-Inferenz** — BirdNET V2.4 + Perch V2 parallel
- 🌅 **Timeline** — Ganzseitige Timeline mit Drag-to-Zoom, einheitlicher Dichte-Slider, SVG-Icons, Filter-Badges mit Blink
- 📆 **Kalender** — Vereinigte Tagesansicht mit Timeline + Artenliste + Audioplayer
- 🌦️ **Wetter** — Korrelationsanalyse (Pearson r), Prognose, Arten nach Bedingungen
- 🎵 **Live-Spektrogramm** — Echtzeit-Audio mit Vogelnamen
- 🔍 **Uberprufung** — Auto-Flagging, Spektrogramm-Modal mit Filtern und Loop-Auswahl, Loschen mit Vorschau
- ⭐ **Favoriten** — eigene Seite mit KPIs, Suche, Sortierung; Herz-Toggle auf allen Artenlisten
- 📝 **Notizen** pro Art und pro Erkennung
- 🦜 **Artenkarten** — Phonologie-Kalender, Jahresvergleich, PNG-Export
- 📱 **Mobil** — Bottom-Navigation, Touch-Gesten, globale Suche (Art + Datum)
- 🔔 **Benachrichtigungen** — ntfy.sh + In-App-Glocke
- 📋 **Live-Log** — Echtzeit-Dashboard (SSE) mit farbcodierten Kategorien, Filtern, KPIs
- 💻 **Web-Terminal** — Bash im Browser
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 📷 **Fotoverwaltung** — Sperren/Ersetzen, Standardfoto pro Art
- 🏷️ **Anpassbares Branding** — Stationsname und Header uber Einstellungen konfigurierbar
- 🌐 **Artnamenubersetzung** — Vogelnamen in gewahlter Sprache auf allen Seiten
- 🌍 4 UI-Sprachen (FR/EN/NL/DE) + 36 Sprachen fur Artnamen
- 🎨 **11 Themes** — 7 dunkel (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 3 hell (Paper, Sepia, Solar Light), plus ein **Auto**-Modus, der `prefers-color-scheme` des Betriebssystems folgt. Mini-Seitenvorschauen im Theme-Picker, fließende Übergänge, vollständig token-basiertes Designsystem (siehe [`docs/THEMES.md`](docs/THEMES.md))

## Optimierte Perch V2 Modelle

3 optimierte Varianten von Google Perch V2 (FP32, FP16, INT8) fur Raspberry Pi:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** auf HuggingFace

## Installation

```bash
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh
```

Das Installationsskript erledigt alles automatisch. Bearbeiten Sie danach:
1. `/etc/birdnet/birdnet.conf` — Koordinaten, Sprache
2. `engine/config.toml` — Station, BirdWeather, ntfy
3. `public/js/birdash-local.js` — Standort, eBird API Key

Dienste starten:
```bash
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

Dashboard: `http://ihr-pi.local/birds/`

## Tests

```bash
npm test                    # 134 Node.js Tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python Tests
```

## Lizenz

[MIT](LICENSE)
