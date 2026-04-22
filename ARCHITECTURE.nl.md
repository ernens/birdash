# BirdStation Architectuur

> [English](ARCHITECTURE.md) | [Français](ARCHITECTURE.fr.md) | [Deutsch](ARCHITECTURE.de.md)

Uitgebreide technische referentie van het BirdStation-systeem (birdash) — een zelfstandig vogeldetectie-dashboard en engine voor Raspberry Pi.

> Dit document wordt om technische consistentie in het Engels onderhouden. De volledige versie vindt u in [ARCHITECTURE.md](ARCHITECTURE.md).

## Samenvatting

```
Raspberry Pi 5 + SSD
├── USB Audio-interface (microfoon)
│     ↓
├── BirdEngine (Python)
│   ├── Opnamedienst (arecord → WAV 45s)
│   ├── Audio-pipeline: Adaptieve versterking → Hoogdoorlaat → Laagdoorlaat
│   │   → Geluidsprofiel-subtractie → RMS-normalisatie
│   ├── BirdNET V2.4 (primair, ~2s/bestand)
│   ├── Perch V2 FP16 (secundair, ~2s/bestand)
│   ├── MP3-extractie + spectrogrammen
│   └── BirdWeather-upload
│
├── Birdash (Node.js)
│   ├── Dashboard-API (poort 7474)
│   ├── Live spectrogram (PCM + MP3-stream)
│   ├── Pushmeldingen via Apprise (100+ diensten)
│   ├── Worker-thread voor What's New (niet-blokkerend)
│   ├── Community-telemetrie (Supabase, opt-in)
│   └── Bugrapportage (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (webterminal)
└── SQLite (1M+ detecties)
```

### Belangrijkste componenten

| Component | Technologie | Rol |
|-----------|------------|-----|
| **BirdEngine** | Python 3 + TFLite | Audio-opname, filtering, dual-model inferentie |
| **Birdash** | Node.js + better-sqlite3 | REST-API, 18 Vue 3-pagina's, cache, aggregaten |
| **Caddy** | Go | Reverse proxy HTTPS, gzip, statische bestanden |
| **SQLite** | C | Detecties, validaties, taxonomie |
| **Supabase** | PostgreSQL | Community-netwerk (opt-in telemetrie) |

### Audio-pipeline

```
🎤 Microfoon → Adaptieve versterking → Hoogdoorlaat → Laagdoorlaat → Geluidsprofiel / Auto-denoise → RMS → 🐦 BirdNET + Perch
```

### Dashboard-pagina's (18)

| Sectie | Pagina's |
|--------|----------|
| Home | Overzicht, Vandaag |
| Live | Bird Flow, Live Board, Spectrogram, Logboek |
| Geschiedenis | Kalender (maandraster), Tijdlijn, Detecties, Review |
| Soorten | Soortenkaarten, Opnamen (Bibliotheek + Beste), Zeldzaamheden, Favorieten |
| Indicatoren | Weer, Statistieken + Diversiteit (tabs), Analyses, Fenologie, Vergelijking |
| Station | Instellingen (9 tabbladen), Systeem |

### Performance

- **Worker-thread** voor zware berekeningen (What's New: 10 SQL-queries → eigen thread)
- **Proactieve cache**: vernieuwing elke 5 min op de achtergrond
- **Voor-geaggregeerde tabellen**: daily_stats, monthly_stats, species_stats, hourly_stats
- **Hardware-aangepaste SQLite-PRAGMAs** (`server/lib/db-pragmas.js`) — `mmap_size=256MB` + `cache_size=64MB` op Pi 4/5, uitgeschakeld op Pi 3 (RAM krap naast arecord)
- **Expressie-index** `idx_date_hour_conf` op `(Date, hour, Confidence)` — de weer-heatmap zakt van 43 s (Caddy-timeout) naar 12 s
- **5-min resultaatcache** op de 5 endpoints `/birds/api/external/weather/*` — warme verzoeken < 10 ms
- **Vendored JS**: Vue.js + Chart.js lokaal geserveerd (geen CDN)

### Engine-modules (engine/)

`engine.py` (~850 r) bevat nu alleen nog de `BirdEngine`-klasse + `main()`. De helpers zijn geëxtraheerd in toegewijde modules: `audio.py` (I/O + filters), `models.py` (TFLite-wrappers + factory), `clips.py` (mp3 + spectrogram), `birdweather.py`, `db.py`, `watcher.py`, `yamnet_filter.py`. Re-exports in `engine.py` houden `from engine import X` werkend voor de tests.

### Soortspecifieke beperking (throttle)

De engine kan dominante soorten beperken om te voorkomen dat ze de DB overspoelen. Configureerbare cooldown per soort (standaard 120 s) met confidence-bypass drempel (standaard 0.95) die zekere detecties altijd doorlaat. Status in geheugen van de engine, hot-reload vanuit `birdnet.conf`. Script `scripts/cleanup_throttle.py` past dezelfde regel retroactief toe op historische data, met DB-backup en audio-quarantaine.

→ **[Volledige technische documentatie lezen (EN)](ARCHITECTURE.md)**
