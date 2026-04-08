# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Zelfstandige dual-model architectuur met BirdNET V2.4 + Perch V2. Aanpasbare stationnaam en branding.

> [English](README.md) | [Francais](README.fr.md) | [Deutsch](README.de.md)

## Schermafbeeldingen

<details>
<summary><b>Live</b> — Dashboard · Vandaag · Spectrogram</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/today.png"       width="240" alt="Vandaag">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogram">
</p>
</details>

<details>
<summary><b>Geschiedenis</b> — Kalender · Tijdlijn · Detecties · Validatie</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Kalender">
  <img src="screenshots/timeline.png"   width="240" alt="Tijdlijn">
  <img src="screenshots/detections.png" width="240" alt="Detecties">
  <img src="screenshots/review.png"     width="240" alt="Validatie">
</p>
</details>

<details>
<summary><b>Soorten</b> — Soort · Opnames · Galerij · Zeldzaamheden</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Soort">
  <img src="screenshots/recordings.png" width="240" alt="Opnames">
  <img src="screenshots/gallery.png"    width="240" alt="Galerij">
  <img src="screenshots/rarities.png"   width="240" alt="Zeldzaamheden">
</p>
</details>

<details>
<summary><b>Inzichten</b> — Weer · Statistieken · Analyses · Biodiversiteit · Fenologie</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Weer">
  <img src="screenshots/stats.png"        width="240" alt="Statistieken">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversiteit">
  <img src="screenshots/phenology.png"    width="240" alt="Fenologie">
</p>
</details>

<details>
<summary><b>Station</b> — Systeemstatus, instellingen &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Systeemstatus">
  <img src="screenshots/system-model.png"    width="240" alt="Modelmonitor">
  <img src="screenshots/system-data.png"     width="240" alt="Systeemgegevens">
  <img src="screenshots/system-external.png" width="240" alt="Extern">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Detectie">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Notificaties">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Services">
  <img src="screenshots/settings-species.png"  width="240" alt="Soorten">
  <img src="screenshots/settings-backup.png"   width="240" alt="Back-up">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Kenmerken

- 🤖 **Dual-model inferentie** — BirdNET V2.4 + Perch V2 parallel
- 🌅 **Timeline** — volledig scherm met drag-to-zoom, uniforme dichtheidsslider, SVG-iconen, filter-badges met knippermarkering
- 📆 **Kalender** — uniforme dagweergave met timeline + soortenlijst + audiospeler
- 🌦️ **Weer** — correlatieanalyse (Pearson r), prognose, soorten per omstandigheden
- 🎵 **Live spectrogram** — real-time audio met vogelnamen
- 🔍 **Review** — auto-flagging, spectrogram-modal met filters en loop-selectie, verwijderen met voorbeeldweergave
- ⭐ **Favorieten** — speciale pagina met KPIs, zoeken, sorteren; harttoggle op alle soortenlijsten
- 📝 **Notities** per soort en per detectie
- 🦜 **Soortkaarten** — fenologiekalender, jaarlijkse vergelijking, PNG-export
- 📱 **Mobiel** — navigatiebalk onderaan, veeggebaren, globale zoekfunctie (soort + datum)
- 🔔 **Meldingen** — ntfy.sh + in-app belletje
- 📋 **Live log** — realtime dashboard (SSE) met kleurgecodeerde categorieën, filters, KPIs
- 💻 **Web terminal** — bash in browser
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 📷 **Fotobeheer** — blokkeren/vervangen, standaardfoto per soort
- 🏷️ **Aanpasbare branding** — stationnaam en header configureerbaar via instellingen
- 🌐 **Soortnaamvertaling** — vogelnamen in gekozen taal op alle pagina's
- 🌍 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen
- 🎨 **11 thema's** — 7 donker (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 3 licht (Paper, Sepia, Solar Light), plus een **Auto**-modus die de OS-instelling volgt. Mini-paginavoorbeelden in de kiezer, vloeiende overgangen, volledig token-gebaseerd ontwerpsysteem (zie [`docs/THEMES.md`](docs/THEMES.md))

## Geoptimaliseerde Perch V2 Modellen

3 geoptimaliseerde varianten van Google Perch V2 (FP32, FP16, INT8) voor Raspberry Pi:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** op HuggingFace

## Installatie

```bash
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh
```

Het installatiescript regelt alles automatisch. Bewerk daarna:
1. `/etc/birdnet/birdnet.conf` — coordinaten, taal
2. `engine/config.toml` — station, BirdWeather, ntfy
3. `public/js/birdash-local.js` — locatie, eBird API key

Start de services:
```bash
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

Dashboard: `http://jouw-pi.local/birds/`

## Tests

```bash
npm test                    # 134 Node.js-tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python tests
```

## Licentie

[MIT](LICENSE)
