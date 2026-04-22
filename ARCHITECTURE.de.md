# BirdStation Architektur

> [English](ARCHITECTURE.md) | [Français](ARCHITECTURE.fr.md) | [Nederlands](ARCHITECTURE.nl.md)

Umfassende technische Referenz des BirdStation-Systems (birdash) — ein eigenständiges Vogelerkennungs-Dashboard und Engine für Raspberry Pi.

> Dieses Dokument wird aus Gründen der technischen Konsistenz auf Englisch gepflegt. Die vollständige Version finden Sie in [ARCHITECTURE.md](ARCHITECTURE.md).

## Zusammenfassung

```
Raspberry Pi 5 + SSD
├── USB-Audio-Interface (Mikrofon)
│     ↓
├── BirdEngine (Python)
│   ├── Aufnahmedienst (arecord → WAV 45s)
│   ├── Audio-Pipeline: Adaptive Verstärkung → Hochpass → Tiefpass
│   │   → Geräuschprofil-Subtraktion → RMS-Normalisierung
│   ├── BirdNET V2.4 (primär, ~2s/Datei)
│   ├── Perch V2 FP16 (sekundär, ~2s/Datei)
│   ├── MP3-Extraktion + Spektrogramme
│   └── BirdWeather-Upload
│
├── Birdash (Node.js)
│   ├── Dashboard-API (Port 7474)
│   ├── Live-Spektrogramm (PCM + MP3-Stream)
│   ├── Push-Benachrichtigungen via Apprise (100+ Dienste)
│   ├── Worker-Thread für What's New (nicht-blockierend)
│   ├── Community-Telemetrie (Supabase, Opt-in)
│   └── Bug-Meldung (GitHub Issues)
│
├── Caddy (Reverse-Proxy :80)
├── ttyd (Web-Terminal)
└── SQLite (1M+ Erkennungen)
```

### Schlüsselkomponenten

| Komponente | Technologie | Rolle |
|-----------|------------|------|
| **BirdEngine** | Python 3 + TFLite | Audioaufnahme, Filterung, Dual-Model-Inferenz |
| **Birdash** | Node.js + better-sqlite3 | REST-API, 18 Vue-3-Seiten, Cache, Aggregate |
| **Caddy** | Go | Reverse-Proxy HTTPS, Gzip, statische Dateien |
| **SQLite** | C | Erkennung, Validierung, Taxonomie |
| **Supabase** | PostgreSQL | Community-Netzwerk (Opt-in-Telemetrie) |

### Audio-Pipeline

```
🎤 Mikrofon → Adaptive Verstärkung → Hochpass → Tiefpass → Geräuschprofil / Auto-Denoise → RMS → 🐦 BirdNET + Perch
```

### Dashboard-Seiten (18)

| Bereich | Seiten |
|---------|--------|
| Startseite | Übersicht, Heute |
| Live | Bird Flow, Live Board, Spektrogramm, Protokoll |
| Verlauf | Kalender (Monatsraster), Timeline, Erkennungen, Überprüfung |
| Arten | Artenkarten, Aufnahmen (Bibliothek + Beste), Seltenheiten, Favoriten |
| Indikatoren | Wetter, Statistiken + Diversität (Tabs), Analysen, Phänologie, Vergleich |
| Station | Einstellungen (9 Tabs), System |

### Performance

- **Worker-Thread** für schwere Berechnungen (What's New: 10 SQL-Abfragen → eigener Thread)
- **Proaktiver Cache**: Aktualisierung alle 5 min im Hintergrund
- **Voraggregierte Tabellen**: daily_stats, monthly_stats, species_stats, hourly_stats
- **Hardware-angepasste SQLite-PRAGMAs** (`server/lib/db-pragmas.js`) — `mmap_size=256MB` + `cache_size=64MB` auf Pi 4/5, auf Pi 3 deaktiviert (RAM eng neben arecord)
- **Ausdrucksindex** `idx_date_hour_conf` auf `(Date, hour, Confidence)` — die Wetter-Heatmap fällt von 43 s (Caddy-Timeout) auf 12 s
- **5-min-Ergebniscache** auf den 5 Endpoints `/birds/api/external/weather/*` — warme Anfragen < 10 ms
- **Vendored JS**: Vue.js + Chart.js lokal ausgeliefert (kein CDN)

### Engine-Module (engine/)

`engine.py` (~850 Zeilen) enthält jetzt nur noch die `BirdEngine`-Klasse + `main()`. Die Helfer wurden in dedizierte Module extrahiert: `audio.py` (I/O + Filter), `models.py` (TFLite-Wrappers + Factory), `clips.py` (mp3 + Spektrogramm), `birdweather.py`, `db.py`, `watcher.py`, `yamnet_filter.py`. Re-Exports in `engine.py` halten `from engine import X` für Tests am Laufen.

### Artspezifische Drosselung

Die Engine kann dominante Arten drosseln, damit sie die DB nicht überfluten. Konfigurierbarer Cooldown pro Art (Standard 120 s) mit Konfidenz-Bypass-Schwelle (Standard 0.95), die sichere Erkennungen immer durchlässt. Zustand im Speicher der Engine, Hot-Reload aus `birdnet.conf`. Skript `scripts/cleanup_throttle.py` wendet dieselbe Regel rückwirkend auf historische Daten an, mit DB-Backup und Audio-Quarantäne.

→ **[Vollständige technische Dokumentation lesen (EN)](ARCHITECTURE.md)**
