# Architecture BirdStation

> [English](ARCHITECTURE.md) | [Deutsch](ARCHITECTURE.de.md) | [Nederlands](ARCHITECTURE.nl.md)

Référence technique complète du système BirdStation (birdash) — dashboard et moteur de détection d'oiseaux autonome pour Raspberry Pi.

> Ce document est maintenu en anglais pour des raisons de cohérence technique. La version complète se trouve dans [ARCHITECTURE.md](ARCHITECTURE.md).

## Résumé

```
Raspberry Pi 5 + SSD
├── Interface Audio USB (microphone)
│     ↓
├── BirdEngine (Python)
│   ├── Service d'enregistrement (arecord → WAV 45s)
│   ├── Pipeline audio : Gain adaptatif → Passe-haut → Passe-bas
│   │   → Soustraction de profil bruit → Normalisation RMS
│   ├── BirdNET V2.4 (primaire, ~2s/fichier)
│   ├── Perch V2 FP16 (secondaire, ~2s/fichier)
│   ├── Extraction MP3 + spectrogrammes
│   └── Upload BirdWeather
│
├── Birdash (Node.js)
│   ├── API Dashboard (port 7474)
│   ├── Spectrogramme en direct (PCM + flux MP3)
│   ├── Notifications push via Apprise (100+ services)
│   ├── Worker thread pour What's New (non-bloquant)
│   ├── Télémétrie communautaire (Supabase, opt-in)
│   └── Signalement de bugs (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (terminal web)
└── SQLite (1M+ détections)
```

### Composants clés

| Composant | Technologie | Rôle |
|-----------|------------|------|
| **BirdEngine** | Python 3 + TFLite | Enregistrement audio, filtrage, inférence dual-model |
| **Birdash** | Node.js + better-sqlite3 | API REST, 18 pages Vue 3, cache, agrégats |
| **Caddy** | Go | Reverse proxy HTTPS, gzip, fichiers statiques |
| **SQLite** | C | Stockage détections, validations, taxonomie |
| **Supabase** | PostgreSQL | Réseau communautaire (télémétrie opt-in) |

### Pipeline audio

```
🎤 Mic → Gain adaptatif → Passe-haut → Passe-bas → Profil bruit / Dénoise auto → RMS → 🐦 BirdNET + Perch
```

Chaque étape est configurable et peut être activée/désactivée indépendamment via **Réglages → Audio**.

### Pages du dashboard (18)

| Section | Pages |
|---------|-------|
| Accueil | Vue d'ensemble, Aujourd'hui |
| En direct | Bird Flow, Live Board, Spectrogramme, Journal |
| Historique | Calendrier (grille mensuelle), Timeline, Détections, Révision |
| Espèces | Fiches, Enregistrements (Bibliothèque + Meilleurs), Raretés, Favoris |
| Indicateurs | Météo, Statistiques + Diversité (onglets), Analyses, Phénologie, Comparaison |
| Station | Réglages (9 onglets), Système |

### Performance

- **Worker thread** pour les calculs lourds (What's New : 10 requêtes SQL → thread séparé)
- **Cache proactif** : rafraîchissement toutes les 5 min en arrière-plan
- **Tables pré-agrégées** : daily_stats, monthly_stats, species_stats, hourly_stats
- **PRAGMAs SQLite adaptés au matériel** (`server/lib/db-pragmas.js`) — `mmap_size=256MB` + `cache_size=64MB` sur Pi 4/5, désactivé sur Pi 3 (RAM serrée à côté d'arecord)
- **Index expression** `idx_date_hour_conf` sur `(Date, hour, Confidence)` — la heatmap météo passe de 43 s (timeout Caddy) à 12 s
- **Cache de résultats 5 min** sur les 5 endpoints `/birds/api/external/weather/*` — requêtes chaudes < 10 ms
- **JS vendorisé** : Vue.js + Chart.js servis localement (pas de CDN)

### Modules du moteur (engine/)

`engine.py` (~1100 l) garde la classe `BirdEngine` + `main()`. Les helpers ont été extraits en modules dédiés : `audio.py` (I/O + filtres), `models.py` (wrappers TFLite + factory), `clips.py` (mp3 + spectrogramme), `birdweather.py`, `db.py`, `watcher.py`, `yamnet_filter.py`, `bbox.py` (localisation temps-fréquence Phase 1), `stability.py` (vérification de stabilité Phase 2). Les re-exports en haut de `engine.py` préservent `from engine import X` côté tests.

### Module de raffinement des détections (mai 2026, versions 1.48 → 1.50)

Couche signal-processing ajoutée pour donner à chaque détection une localisation temps-fréquence et un score de stabilité optionnel. Spec complète : [`docs/refinement/SPEC-v2.md`](docs/refinement/SPEC-v2.md).

| Niveau | Déclenchement | Coût | Sortie | Statut |
|---|---|---|---|---|
| 1 — Bbox heuristique | Live, chaque détection | ~200 ms (Pi 5) / ~1-2 s (Pi 3) | `detection_bbox_v1` (PK file_name, bornes t/f, pic, SNR) | Live depuis 1.49.0 ; filtres v1.5 depuis 1.49.1 |
| 2 — Stability check | Confiance < seuil (défaut 0.6), opt-in | ~1.5-9 s par détection (re-inférence Perch) | `detection_stability_v1` (`stable` / `unstable` / `inconclusive`) | Worker depuis 1.50.0, désactivé par défaut |
| 3 — Raffinement on-demand | À la demande utilisateur | minutes par détection | (différé Phase 3, voir SPEC §5) | non livré |

Chaque spectrogramme du dashboard (cards `today.html`, modal plein écran, future `review.html`) affiche un encadré amber pointillé sur la zone localisée. Toggle dans la modal, préférence persistée (`localStorage:birdash:showBbox`).

Quand Phase 2 marque une détection `unstable`, l'endpoint `/api/flagged-detections` la remonte via une nouvelle règle `recentering_unstable` dans `config/detection_rules.json` — pas de nouveau code UI, le badge apparaît à côté de `nocturnal_day`, `out_of_season` etc. dans `review.html`.

Backfill : `scripts/refinement/backfill_bbox.py` re-calcule les bboxes historiques sous `nice -n 19 ionice -c 3` pour ne pas concurrencer le moteur live. Idempotent via UPSERT, supprime les rows obsolètes quand l'algorithme courant rejette.

### Limite par espèce (throttle)

Le moteur peut limiter les espèces dominantes pour éviter qu'elles ne saturent la DB. Cooldown configurable par espèce (défaut 120 s) avec seuil de bypass de confiance (défaut 0.95) qui laisse toujours passer les détections sûres. État en mémoire dans le moteur, hot-reloadé depuis `birdnet.conf`. Script `scripts/cleanup_throttle.py` pour appliquer la même règle rétroactivement à l'historique avec backup DB et quarantaine audio.

→ **[Lire la documentation technique complète (EN)](ARCHITECTURE.md)**
