# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Zelfstandige dual-model architectuur met BirdNET V2.4 + Perch V2. Community-netwerk met live stationskaart. Aanpasbare stationnaam en branding.

> [English](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Schermafbeeldingen

**Highlights** — scroll horizontaal voor een overzicht van de belangrijkste pagina's. Volledige galerijen per sectie hieronder uitvouwbaar.

<table>
  <tr>
    <td align="center"><img src="screenshots/overview.png"    width="260" alt="Overzicht"></td>
    <td align="center"><img src="screenshots/today.png"       width="260" alt="Vandaag"></td>
    <td align="center"><img src="screenshots/spectrogram.png" width="260" alt="Spectrogram"></td>
    <td align="center"><img src="screenshots/weather.png"     width="260" alt="Weer"></td>
    <td align="center"><img src="screenshots/species.png"     width="260" alt="Soorten"></td>
    <td align="center"><img src="screenshots/recordings.png"  width="260" alt="Opnamen"></td>
    <td align="center"><img src="screenshots/review.png"      width="260" alt="Review"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Overzicht</b><br>KPIs &amp; vogel van de dag</sub></td>
    <td align="center"><sub><b>Vandaag</b><br>live detecties + filters</sub></td>
    <td align="center"><sub><b>Spectrogram</b><br>volledig scherm + weer-chip</sub></td>
    <td align="center"><sub><b>Weer</b><br>leaderboards · heatmap · zoeken</sub></td>
    <td align="center"><sub><b>Soorten</b><br>geschiedenis + weerprofiel</sub></td>
    <td align="center"><sub><b>Opnamen</b><br>bibliotheek + beste per soort</sub></td>
    <td align="center"><sub><b>Review</b><br>auto-flag + bulk acties</sub></td>
  </tr>
</table>

<details>
<summary><b>Live</b> — Dashboard · Vandaag · Spectrogram</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/today.png"       width="240" alt="Vandaag">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogram">
</p>
</details>

<details>
<summary><b>Geschiedenis</b> — Kalender · Tijdlijn · Detecties · Review</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Kalender">
  <img src="screenshots/timeline.png"   width="240" alt="Tijdlijn">
  <img src="screenshots/detections.png" width="240" alt="Detecties">
  <img src="screenshots/review.png"     width="240" alt="Review">
</p>
</details>

<details>
<summary><b>Soorten</b> — Soort · Opnamen · Galerij · Zeldzaamheden · Favorieten</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Soort">
  <img src="screenshots/recordings.png" width="240" alt="Opnamen">
  <img src="screenshots/rarities.png"   width="240" alt="Zeldzaamheden">
  <img src="screenshots/favorites.png"  width="240" alt="Favorieten">
</p>
</details>

<details>
<summary><b>Indicatoren</b> — Weer · Statistieken · Modellen · Analyses · Biodiversiteit · Fenologie · Seizoenen · Vergelijken</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Weer">
  <img src="screenshots/stats.png"        width="240" alt="Statistieken">
  <img src="screenshots/system-model.png" width="240" alt="Modellen">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversiteit">
  <img src="screenshots/phenology.png"    width="240" alt="Fenologie">
  <img src="screenshots/comparison.png"   width="240" alt="Seizoenen">
  <img src="screenshots/compare.png"      width="240" alt="2 soorten vergelijken">
</p>
</details>

<details>
<summary><b>Station</b> — Systeemgezondheid, instellingen &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Systeemgezondheid">
  <img src="screenshots/system-model.png"    width="240" alt="Modelmonitor">
  <img src="screenshots/system-data.png"     width="240" alt="Systeemdata">
  <img src="screenshots/system-external.png" width="240" alt="Extern">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Detectie">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Meldingen">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Diensten">
  <img src="screenshots/settings-species.png"  width="240" alt="Soorten">
  <img src="screenshots/settings-backup.png"   width="240" alt="Backup">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architectuur

> **[Volledige architectuurdocumentatie →](ARCHITECTURE.nl.md)** — technische referentie: audio-pipeline, databaseschema, performance en meer.

```
Raspberry Pi 5 + SSD
├── USB Audio-interface
│     ↓
├── BirdEngine (Python)
│   ├── Opname (arecord → WAV 45s)
│   ├── Audio-pipeline: Adaptieve versterking → Hoogdoorlaat → Laagdoorlaat
│   │   → Geluidsprofiel-subtractie → RMS-normalisatie
│   ├── BirdNET V2.4    (~1.5s/bestand, primair)
│   ├── Perch V2         (~0.7s/bestand op Pi 5, secundair)
│   ├── MP3-extractie + spectrogrammen
│   └── BirdWeather-upload
│
├── Birdash (Node.js)
│   ├── Dashboard-API (poort 7474)
│   ├── Live spectrogram (PCM + MP3-stream)
│   ├── Push-meldingen via Apprise (100+ diensten)
│   ├── Detectiereview + auto-flagging
│   ├── Telemetrie (opt-in Supabase)
│   └── In-app bugrapportage (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (web terminal)
└── SQLite (1M+ detecties)
```

## Functies

### Detectie-engine (BirdEngine)
- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Dual-model inferentie** — BirdNET V2.4 (~1.5s/bestand) + Perch V2 (~0.7s/bestand op Pi 5) parallel. Modelvariant automatisch geselecteerd per Pi: FP32 op Pi 5, FP16 op Pi 4, INT8 op Pi 3
- <img src="docs/icons/shield-check.svg" width="16" align="top" alt=""> **Dual-model kruisbevestiging** — Perch-detecties onder een standalone-drempel (standaard 0.85) moeten bevestigd worden door BirdNET (ruwe score ≥ 0.15) op een overlappende chunk. Schakelt het gros van de Perch valse positieven op laagfrequent geluid uit (wind, voertuigen → ganzen/reigers/raven), zonder Perchs voordeel bij zeldzame soorten te verliezen. Drie drempels instelbaar in Instellingen → Detectie met (i)-tooltips
- <img src="docs/icons/timer.svg" width="16" align="top" alt=""> **Soortspecifieke beperking** — opt-in, cooldown per soort (standaard 120 s), voorkomt dat dominante soorten (mussen, merels…) de DB overspoelen, terwijl hoge-confidentie detecties (≥ bypass-drempel, standaard 0.95) altijd doorkomen. Status in geheugen van de engine, hot-reload vanuit `birdnet.conf`. Script `scripts/cleanup_throttle.py` past dezelfde regel retroactief toe op historische rijen met `--dry-run` / `--apply`, DB-backup en audio-quarantaine — typisch 60-70 % opschoning op luidruchtige stations
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Lokale opname** — elke USB-audio-interface via ALSA met configureerbare gain
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Adaptieve geluidsnormalisatie** — automatische softwarematige gain op basis van omgevingsgeluid, met clip-bescherming, activiteitshold en observermodus
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Audiofilters** — configureerbare hoogdoorlaat + laagdoorlaat (bandpass), spectrale ruisonderdrukking (stationaire gating), RMS-normalisatie
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdWeather** — automatische upload van soundscapes + detecties
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Slimme push-meldingen** — via Apprise (ntfy, Telegram, Discord, Slack, e-mail, 100+ diensten) met soortfoto bijgevoegd, stationsnaam-prefix (`[Heinsch] Merel`). 5 configureerbare regels: zeldzame soorten, eerste van het seizoen, nieuwe soort, eerste van de dag, favorieten
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **MQTT-publisher** — opt-in, publiceert elke detectie naar een MQTT-broker (Mosquitto, EMQX, HiveMQ…) op `<prefix>/<station>/detection`, met retained `last_species` topic en LWT online/offline status. Optioneel **Home Assistant auto-discovery** maakt automatisch `Last species` + `Last confidence` sensor-entiteiten. QoS, retain, TLS, gebruikersnaam/wachtwoord, minimale confidentie configureerbaar — Test in één klik vanuit Instellingen
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Prometheus `/metrics` endpoint** — scrape `http://uw-pi.local/birds/metrics` vanuit Prometheus / Grafana / VictoriaMetrics. Custom gauges (detecties total/vandaag/laatste uur, soorten, leeftijd laatste detectie, DB-grootte), systeem gauges (CPU temp, gebruik, RAM, disk, fan RPM, uptime), feature toggles, en standaard Node.js process metrics. Lazy ververst bij elke scrape
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Live geluidsniveau (Leq / piek)** — RMS en piek in dBFS per opname, beschikbaar op `/metrics` (`birdash_sound_leq_dbfs`, `_peak_dbfs`, `_leq_1h_avg_dbfs`) en getoond als live kaart in Instellingen → Audio met sparkline van 60 punten. Handig om wind, verkeer, een dode microfoon of stille nachten te spotten. Ongekalibreerd (trend, geen absoluut SPL). Optionele Apprise-alerts wanneer de gemiddelde Leq 15 min onder `-90 dBFS` valt (stille mic) of boven `-5 dBFS` blijft (clipping)
- <img src="docs/icons/lock.svg" width="16" align="top" alt=""> **Auth & toegangscontrole** — opt-in cookie-sessies (één gebruiker, bcrypt). Drie modi: `off` (LAN-vertrouwen, standaard), `protected` (login voor alles), en **`public-read`** (iedereen kan detecties, soorten en stats bekijken — login alleen om instellingen te wijzigen of gevoelige data te zien). HMAC-getekende cookies, geen DB-sessies te beheren. Bearer token (`BIRDASH_API_TOKEN`) blijft parallel werken voor cron/automatisering. Login-pogingen gelimiteerd tot 5/min/IP. Zie **[Op het internet exponeren](#op-het-internet-exponeren)** hieronder
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Geografisch filter** — BirdNET MData-filter (al actief, configureerbaar via `SF_THRESH`) toont nu de **live lijst van soorten verwacht op uw locatie voor de huidige week** (Instellingen → Detectie). Plus opt-in **eBird-filter voor Perch** dat Perch-detecties dropt die niet op de lokale eBird "recent waargenomen"-kaart staan — Perch heeft geen ingebouwd geografisch model en rapporteert anders tropische soorten in gematigde zones
- <img src="docs/icons/shield.svg" width="16" align="top" alt=""> **Pre-analyse filters (YAMNet)** — opt-in **privacyfilter** (dropt detecties + verwijdert optioneel de WAV als menselijke stem wordt gedetecteerd, AVG-vriendelijke standaard) en **hondengeblaf-filter** (dropt detecties + cooldown wanneer geblaf / huilen / grommen wordt gedetecteerd — stopt de cascade van valse positieven die honden veroorzaken). Aangedreven door Google's YAMNet (AudioSet, 521 audioklassen, 4 MB TFLite, gebundeld). Eén model, twee filters, ~30 ms extra latency per opname op Pi 5
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> **Wekelijks redactioneel digest** — maandag 8u, 5 gecureerde regels via Apprise: getallen + delta vs N-1, highlight (zeldzaam > eerste van het jaar > opmerkelijk), beste moment, fenologische verschuiving, top 3 soorten. Opt-in, optionele tag-routing
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Asynchrone post-processing** — MP3-extractie, spectrogram-generatie, DB-sync blokkeren de inferentie niet

### Dashboard (20 pagina's)

**Home**
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Overzicht** (landingspagina) — 6 KPIs (incl. tijd eerste detectie), "What's New"-alerts, weercontext, uurlijkse activiteit. Uitgelichte detectiekaart met twee tabs: **Laatste detectie** (station-alive signaal) en **Beste van vandaag** (hoogste-confidentie pick van de dag)
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Vandaag** — soortenlijst met sortering (aantal / eerste gehoord / max conf / nieuwe eerst) en gescheiden aantal/confidentie pills. Per-soort **interpretatieve samenvatting** (deterministische status: te reviewen / enkele zwak / geïsoleerde burst / herhaald hoge confidentie / vooral bij dageraad / hele dag aanwezig). Spectrogram met **verwachte frequentieband-overlay** (~95 soorten, omschakelbaar). Audiospeler met gain/HP/LP filters. Direct deep-link naar **Review** met soort + datum voorgefilterd
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Soortnaamvertaling** — vogelnamen in de gekozen taal op alle pagina's

**Live**
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Bird Flow** — geanimeerde pipeline met live audioniveaus (SSE), dual-model inferentie met per-model soorten + confidentie, detectiestroom met geanimeerde verbinders, KPIs van vandaag, key-events feed
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Live spectrogram** — realtime audio van de microfoon met vogelnaam-overlay
- <img src="docs/icons/scroll-text.svg" width="16" align="top" alt=""> **Live log** — realtime streaming dashboard (SSE) met kleurgecodeerde categorieën, KPIs, pauze/hervatten
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> **Live Board** — fullscreen kioskweergave voor een dedicated scherm: grote soortfoto, KPIs, soortenlijst van vandaag, weer, auto-refresh 30s, discrete terug-knop

**Geschiedenis**
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Kalender** — maandgrid met aantal soorten per dag, aantal detecties, activiteit-heatmap, nieuwe-soort badges (★) en zeldzaamheid-badges (◆). Klik op cel met badges voor popover met soortfoto's en namen. Klik op elke dag voor detailweergave
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Tijdlijn** — fullpage interactieve tijdlijn met drag-to-zoom, uniforme vogeldichtheids-slider (0-100%), SVG zonsopgang/-ondergang/maan iconen, type filter-badges met blink-highlight, confidentie-gemapte verticale layout
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Detecties** — volledig filterbare tabel met favorieten, nieuwe-soort filter, per-detectie verwijderen, CSV/eBird export
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Review** — auto-geflagde detecties met spectro modal, bulk confirm/reject/delete met preview, geweigerde purge

**Soorten**
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> Soortkaarten met foto's (iNaturalist + Wikipedia), IUCN-status, favorieten (SQLite), persoonlijke notities (per soort en per detectie), fenologie-kalender (12-maands dot map), jaarvergelijking maandelijks, chart PNG-export, Web Share API
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favorieten** — eigen pagina met KPIs, zoeken, sorteren; harttoggle op alle soortenlijsten
- <img src="docs/icons/gem.svg" width="16" align="top" alt=""> **Zeldzaamheden** — fullwidth klikbare KPI-kaarten, filterbare tabel (één keer gezien / nieuw dit jaar), gedetailleerde soortenlijst met foto's en confidentie-badges
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Opnamen** — uniforme audiobibliotheek met twee tabs: "Bibliotheek" (alle opnamen, sorteer-/filterbaar) en "Beste" (top opnamen gegroepeerd per soort)

**Indicatoren**
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Weer** — Open-Meteo correlatieanalyse (Pearson r), prognose voor morgen, plus volledige ornithologische analytics: 4 leaderboards (koudebestendigheid · onweerszangers · zware regen · sterke wind), heatmap soorten × temperatuur (top 30, bins -15…+35 °C) en live aangepaste zoekkaart met 6 filterbare dimensies (temp, neerslag, wind, uur, periode, condities) — beantwoordt "welke soorten blijven actief bij vorst?" in één klik. URL-deelbare filters en CSV-export
- <img src="docs/icons/thermometer.svg" width="16" align="top" alt=""> **Weercontext per detectie** — elke detectie wordt getagd met de uurlijkse weer-snapshot (temp, vochtigheid, wind, neerslag, wolken, druk, WMO-code) via de `weather-watcher` worker die Open-Meteo opvraagt. Compacte weer-chips op `today`, `overview`, `recordings`, `rarities`, `review`, `favorites` en in de spectrogram-modal. Per-soort "Weerprofiel"-paneel op `species.html` met stats (gem. temp, bereik, % bij neerslag) en distributiehistogrammen. Volledige backfill via Open-Meteo's gratis archief-API (geen sleutel nodig)
- <img src="docs/icons/trending-up.svg" width="16" align="top" alt=""> **Statistieken** — rankings, records, distributies, jaarlijkse evolutie; geïntegreerd **Modellen** tab voor dual-model vergelijking (dagelijkse chart, exclusieve soorten, overlap-analyse)
- <img src="docs/icons/microscope.svg" width="16" align="top" alt=""> Geavanceerde analyses (polaire diagrammen, heatmaps, tijdreeksen, narratief)
- <img src="docs/icons/dna.svg" width="16" align="top" alt=""> Biodiversiteit — Shannon-index, adaptieve rijkdomschart, taxonomie heatmap
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Fenologie-kalender** — geobserveerde jaarcyclus per soort (modi presentie/abundantie/uurlijks), afgeleide fasen (actieve periode, abundantiepiek, dagerakoor, migrantdetectie), 53-weeks ribbon-visualisatie, soortvoorstellen op leeg
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Seizoenen** — seizoensgebonden ornithologisch rapport (lente/zomer/herfst/winter). Migratie-aankomsten met datumvergelijking vs vorig jaar (eerder/later), vertrekken, seizoensexclusieve soorten, multi-jaar evolutiechart, beste dagen, top soorten met jaar-delta
- <img src="docs/icons/git-compare.svg" width="16" align="top" alt=""> **Vergelijken** — side-by-side disambiguatie van 2 soorten. Identiteitskaarten, deterministisch verdict (niet genoeg data / mogelijke modelverwarring / sterke seizoensscheiding / verschillende profielen), 24h activiteitsoverlay, weekfenologie-overlay, confidentie-histogram, betrouwbaarheidsbadge. Hardcoded "vaak verward" paren (Tjiftjaf/Fitis, Matkop/Glanskop…)

**Navigatie**
- 6 intentie-gebaseerde secties: Home, Live, Geschiedenis, Soorten, Indicatoren, Station
- Mobiele bottom nav (4 quick links + hamburger drawer met alle 20 pagina's)
- Globale soort+datum zoeken, meldingsbel, review badge teller
- Toetsenbord-shortcuts op 5 pagina's, swipegebaren op soortfoto's
- Skeleton-laadstatussen voor data-zware pagina's
- Cross-navigatie tussen instellingen en systeempagina's

### Eerste-run setup wizard
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **7-staps hardware-bewuste modal** — auto-geactiveerd bij verse install (geen setup-flag, lat/lon=0). Detecteert Pi-model, RAM, geluidskaarten, schijven, internet via `/api/setup/hardware-profile` en stelt aangepaste defaults voor. Stappen: Welkom (met gedetecteerde hardware-preview) → Locatie → Audiobron (USB-aanbevolen badge) → Model (Single/Dual op basis van hardware) → Pre-filters (privacy + hond) → Integraties (BirdWeather, Apprise) → Recap. **Past config toe op disk zonder dienst te herstarten** — lopende detecties nooit onderbroken, gebruiker herstart de engine wanneer klaar. Op elk moment opnieuw uit te voeren vanuit Instellingen → Station → "Wizard starten". Auto-overgeslagen na eerste succesvolle voltooiing via `config/setup-completed.json`. Beschikbaar in 4 talen.

### Detectiereview
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Auto-flagging** — nachtelijke vogels overdag, off-season migranten, lage confidentie geïsoleerd, niet-Europese soorten
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Bulkacties** — confirm/reject/delete per regel, per selectie, of purge alle geweigerden
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> Volledig spectrogram modal met gain/hoogdoorlaat/laagdoorlaat filters en loop-selectie voor handmatige verificatie
- <img src="docs/icons/trash-2.svg" width="16" align="top" alt=""> **Permanente verwijdering** — preview modal lijst wat verwijderd wordt (DB + audiobestanden), met resultaatrapport

### Audioconfiguratie
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> Auto-detectie van USB audio-apparaten met één-klik selectie
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Adaptieve gain** — ruisvloer-schatting, clip-bescherming, activiteitshold, observer/apply modi
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Bandpass + denoise** — hoogdoorlaat (50-300 Hz), laagdoorlaat (4-15 kHz), spectraal gating (noisereduce), allemaal omschakelbaar per profiel
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Omgevingsruis-profiel** — neemt 5s achtergrondruis op (snelweg, HVAC), gebruikt voor gerichte spectrale subtractie via noisereduce `y_noise` — effectiever dan auto-denoise voor constante ruisbronnen
- <img src="docs/icons/eye.svg" width="16" align="top" alt=""> **Filtervoorvertoning** — voor/na spectrogrammen vanaf live mic om het effect van elk filter te visualiseren incl. ruisprofiel
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Audio-pipeline** — Mic → Adaptieve gain → Hoogdoorlaat → Laagdoorlaat → Ruisprofiel (of auto denoise) → RMS-normalisatie → BirdNET + Perch — visueel pipeline-diagram in Instellingen
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> 6 omgevingsprofielen (tuin, bos, langs de weg, stedelijk, nacht, test)
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> Inter-kanaal kalibratiewizard voor dubbele EM272-microfoons
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> Realtime VU-meters via SSE

### Community-netwerk
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdStation Network** — opt-in community van stations die dagelijkse detectie-samenvattingen delen via Supabase
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **[Live stationskaart](https://ernens.github.io/birdash-network/)** — alle geregistreerde stations op een interactieve donkere kaart
- <img src="docs/icons/bug.svg" width="16" align="top" alt=""> **In-app bugrapportage** — dien issues in direct vanuit de dashboard-header naar GitHub, met optionele log-bijlage (laatste uur servicelogs in de issue)

### Instellingen & systeem
- <img src="docs/icons/wrench.svg" width="16" align="top" alt=""> Volledige instellingen-UI — modellen (één-klik BirdNET-download met licentie-acceptatie), analyseparameters, meldingen, audio, backup
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **Interactieve GPS-kaart** — Leaflet/OpenStreetMap widget in stationsinstellingen met klik-om-in-te-stellen, drag marker en geolocatie-knop
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> Systeemgezondheid — CPU, RAM, disk, temperatuur, diensten
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Web terminal** — volledige bash in de browser, ondersteunt Claude Code
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV met planning
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **12 thema's** — 7 donker (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 4 licht (Paper, Sepia, Solar Light, Colonial), plus een **Auto**-modus die `prefers-color-scheme` van het OS volgt. Mini-paginavoorbeelden in de kiezer, vloeiende cross-fade tussen thema's, volledig token-gebaseerd ontwerpsysteem (zie [`docs/THEMES.md`](docs/THEMES.md))
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Fotobeheer** — blokkeren/vervangen, voorkeursfoto per soort
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Aanpasbare branding** — stationnaam en header brand configureerbaar via instellingen
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> **Locale-aware eenheden en formaten** — auto-gedetecteerd uit browser locale (°C/°F, km/h/mph, 12u/24u, DMJ/MDJ/ISO, ma/zo weekstart), te overschrijven in Instellingen → Station

## Geoptimaliseerde Perch V2 modellen

We publiceren **3 geoptimaliseerde Perch V2 TFLite-modellen** voor edge deployment, geconverteerd vanuit Google's officiële SavedModel:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** op HuggingFace

| Model | Grootte | Latency (Pi 5) | Top-1 | Top-5 | Ideaal voor |
|-------|---------|----------------|-------|-------|-------------|
| `perch_v2_original.tflite` | 409 MB | 435 ms | referentie | referentie | **Pi 5** (standaard) |
| `perch_v2_fp16.tflite` | 205 MB | 384 ms | 100% | 99% | **Pi 4** (standaard) |
| `perch_v2_dynint8.tflite` | 105 MB | 299 ms | 93% | 90% | **Pi 3** (standaard) |

Benchmarks op Raspberry Pi 5 (8 GB, Cortex-A76 @ 2.4 GHz), 20 echte vogelopnamen van 20 soorten, 5 runs elk, 4 threads. De installer kiest automatisch de optimale variant voor uw Pi-model.

## Hardware

| Component | Aanbevolen |
|-----------|------------|
| SBC | Raspberry Pi 5 (8 GB) aanbevolen — werkt ook op Pi 4 (4 GB+) en Pi 3 (1 GB, alleen INT8-modellen) |
| Opslag | NVMe SSD (500 GB+) |
| Audio | Elke USB-audio-interface (bijv. RODE AI-Micro, Focusrite Scarlett, Behringer UMC, UGreen 30724) + microfoon |
| Netwerk | Ethernet of WiFi |

## Op het internet exponeren

Standaard vertrouwt birdash het LAN — iedereen op `192.168.x.x` kan instellingen wijzigen. Om uw station veilig aan vrienden te tonen of in een openbare site te embedden:

1. **Auth inschakelen.** Kies in **Instellingen → Station → Beveiliging** een modus:
   - **`Public read-only`** ⭐ — bezoekers kunnen detecties, soorten, stats, audio bekijken. Login nodig om instellingen te wijzigen, detecties te bewerken of logs te zien. **Aanbevolen voor publiek delen.**
   - **`Protected`** — login nodig voor alles.

   Stel gebruikersnaam + wachtwoord in (8 tekens min, bcrypt-gehasht in `birdnet.conf`). Login-pogingen gelimiteerd 5/min/IP.

2. **Reverse-tunnel met Cloudflare** (geen port-forwarding, gratis TLS, verbergt uw thuis-IP):

   ```bash
   # Op uw Pi
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb

   # Login + tunnel maken
   cloudflared tunnel login
   cloudflared tunnel create birdash
   cloudflared tunnel route dns birdash birds.example.com

   # /etc/cloudflared/config.yml
   tunnel: <UUID-from-create>
   credentials-file: /root/.cloudflared/<UUID>.json
   ingress:
     - hostname: birds.example.com
       service: http://localhost:80
     - service: http_status:404

   sudo cloudflared service install
   sudo systemctl restart cloudflared
   ```

   Uw station is nu bereikbaar op `https://birds.example.com/birds/` met end-to-end TLS, geen open poorten op uw router, en Cloudflare voor eventueel misbruik.

3. **Bearer-token niet vergeten.** Als u ook `BIRDASH_API_TOKEN` voor cron/automatisering gebruikt, werkt dat parallel — gebruik de `Authorization: Bearer <token>` header in plaats van inloggen.

Alternatieven: Tailscale Funnel, ngrok, gewone port-forward + Caddy met Let's Encrypt — birdash maakt het niet uit welke transport, zolang iets TLS ervoor termineert.

## Vereisten

- Raspberry Pi 3/4/5 met Raspberry Pi OS 64-bit (Bookworm/Trixie) — Pi 5 aanbevolen voor dual-model
- Internetverbinding (voor initiële setup en model-download)
- USB-audio-interface + microfoon(s)
  - Lavalier (clip-on) microfoons met **TRRS**-stekker hebben een **TRRS→TRS-adapter** nodig voor standaard USB-geluidskaarten
  - De installer configureert ALSA automatisch met software gain boost voor weinig gevoelige USB-mics

Alle andere afhankelijkheden worden automatisch geïnstalleerd door de installer.

## Installatie

### One-line install (aanbevolen)

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

Dat is alles. De bootstrap installeert git indien nodig, kloont de repo naar `~/birdash`, draait `install.sh` non-interactief, downloadt het BirdNET V2.4 model, schakelt dual-model detectie in (BirdNET + Perch), en start alle diensten. Wanneer klaar, open de dashboard-URL die aan het eind wordt geprint en stel GPS/audio in via **Instellingen**.

BirdNET V2.4 valt onder **CC-BY-NC-SA 4.0** (niet-commercieel gebruik — zie de [BirdNET-Analyzer repo](https://github.com/kahst/BirdNET-Analyzer)). Om de BirdNET-download over te slaan en alleen Perch te gebruiken:

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | BIRDASH_SKIP_BIRDNET=1 bash
```

### Handmatige installatie

```bash
# 1. Klonen en installeren
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh                # interactief
# of: ./install.sh --yes    # non-interactief

# 2. Alle diensten starten
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd

# 3. Open het dashboard en configureer
#    → Instellingen → Station: stel GPS in via interactieve kaart
#    → Instellingen → Detectie: download BirdNET V2.4 (één klik)
#    → Instellingen → Audio: selecteer uw USB-audio-apparaat
```

De installer regelt alles: systeempakketten, Caddy, ttyd, databases, Perch V2 modellen (auto-gedownload van HuggingFace, variant aangepast aan uw Pi-model), diensten en cron-jobs. BirdNET V2.4 wordt geïnstalleerd via het dashboard (CC-NC-SA licentie-acceptatie vereist).

Uw dashboard is beschikbaar op `http://uwpi.local/birds/`

## Updaten

### In-app update (aanbevolen)

Wanneer een nieuwe versie beschikbaar is, verschijnt bovenaan elke pagina een rode banner met de echte semver-versie (bijv. `v1.7.0 → v1.7.3`). Klik **Bekijken** voor gecategoriseerde release notes, daarna:

- **Nu installeren** — past de update toe, herstart diensten met health-check, herlaadt de pagina
- **Later (24u)** — snoozet de banner voor 24 uur
- **Deze updates overslaan** — verbergt tot een nieuwere versie wordt gepubliceerd

Bij falen:
- **Rollback** — keert terug naar de vorige versie (verschijnt als `previousCommit` bekend is)
- **Update forceren** — forceert update zelfs met divergente geschiedenis of vuile bestanden
- **Log tonen** — uitklapbare log-viewer voor debugging

Bij succes: bevestiging getoond, pagina herlaadt na 2 seconden.

### Remote update via SSH

```bash
ssh user@uwpi.local 'bash ~/birdash/scripts/update.sh'
```

### Fan-out naar meerdere stations

```bash
for h in mickey donald papier; do
  ssh "$h.local" 'bash ~/birdash/scripts/update.sh'
done
```

## Tests

```bash
# Node.js backend tests (160 tests incl. cross-page coherentie)
npm test

# Python engine tests (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v

# Smoke test — laadt elke pagina in een headless browser, captured pageerror
# + console.error + 5xx, exit non-zero bij elke fout. Vangt stille regressies
# die screenshot-only runs missen (gebroken JS, ontbrekende iconen, pagina's
# die niet mounten).
npm run smoke                       # lokaal
npm run smoke http://biloute.local  # tegen elk Pi-station

# Refresh README screenshots (Paper-thema, EN, 1440x900)
npm run screenshots
```

## Telemetrie & privacy

BirdStation heeft twee onafhankelijke telemetrie-lagen:

**Anonieme gebruiks-pings** (opt-out) — standaard ingeschakeld, uitschakelbaar in Instellingen → Station:
- Stuurt een maandelijkse ping met: `versie`, `Pi-model`, `OS`, `land`
- **Geen** GPS, UUID, stationnaam, IP of andere persoonlijke data
- Install- en update-events worden ook geregistreerd (zelfde anonieme data)
- Helpt ons adoptie te volgen en te weten welke platforms te prioriteren
- Te allen tijde uit te schakelen in Instellingen → Station → "Anonieme gebruiksstatistieken"

**Community-netwerk** (opt-in) — standaard uitgeschakeld:
- Registreert uw station op de [live kaart](https://ernens.github.io/birdash-network/) met GPS + stationnaam
- Stuurt dagelijkse detectie-samenvattingen (top soorten, zeldzame soorten)
- Inschakelen in Instellingen → Station → "Sluit aan bij het netwerk"

Beide lagen gebruiken Supabase met een publieke anon-key (write-only RLS). Geen data wordt verzameld tot de dienst start, en anonieme pings kunnen volledig worden uitgeschakeld.

## Community

- **[Live stationskaart](https://ernens.github.io/birdash-network/)** — alle geregistreerde BirdStation-installaties wereldwijd
- **[Bug rapporteren](https://github.com/ernens/birdash/issues)** — of gebruik de in-app bugreport-knop (rood bug-icoon in de header)
- **[Discussions](https://github.com/ernens/birdash/discussions)** — vragen, ideeën, toon uw setup

## Licentie

[MIT](LICENSE)
