# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Dashboard et moteur de détection d'oiseaux moderne pour Raspberry Pi 5. Architecture dual-modèle autonome avec BirdNET V2.4 + Perch V2. Réseau communautaire avec carte des stations en direct. Nom de station et branding personnalisables.

> [English](README.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Captures d'écran

**Highlights** — défile horizontalement pour un aperçu des pages principales. Galeries détaillées par section dépliables ci-dessous.

<table>
  <tr>
    <td align="center"><img src="screenshots/overview.png"    width="260" alt="Vue d'ensemble"></td>
    <td align="center"><img src="screenshots/today.png"       width="260" alt="Aujourd'hui"></td>
    <td align="center"><img src="screenshots/spectrogram.png" width="260" alt="Spectrogramme"></td>
    <td align="center"><img src="screenshots/weather.png"     width="260" alt="Météo"></td>
    <td align="center"><img src="screenshots/species.png"     width="260" alt="Espèces"></td>
    <td align="center"><img src="screenshots/recordings.png"  width="260" alt="Enregistrements"></td>
    <td align="center"><img src="screenshots/review.png"      width="260" alt="Validation"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Vue d'ensemble</b><br>KPIs &amp; oiseau du jour</sub></td>
    <td align="center"><sub><b>Aujourd'hui</b><br>détections en direct + filtres</sub></td>
    <td align="center"><sub><b>Spectrogramme</b><br>plein écran + chip météo</sub></td>
    <td align="center"><sub><b>Météo</b><br>leaderboards · heatmap · recherche</sub></td>
    <td align="center"><sub><b>Espèces</b><br>historique + profil météo</sub></td>
    <td align="center"><sub><b>Enregistrements</b><br>bibliothèque + meilleurs</sub></td>
    <td align="center"><sub><b>Validation</b><br>auto-flag + actions en masse</sub></td>
  </tr>
</table>

<details>
<summary><b>En direct</b> — Tableau de bord · Aujourd'hui · Spectrogramme</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Tableau de bord">
  <img src="screenshots/today.png"       width="240" alt="Aujourd'hui">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogramme">
</p>
</details>

<details>
<summary><b>Historique</b> — Calendrier · Timeline · Détections · Validation</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Calendrier">
  <img src="screenshots/timeline.png"   width="240" alt="Timeline">
  <img src="screenshots/detections.png" width="240" alt="Détections">
  <img src="screenshots/review.png"     width="240" alt="Validation">
</p>
</details>

<details>
<summary><b>Espèces</b> — Espèce · Enregistrements · Galerie · Raretés · Favoris</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Espèce">
  <img src="screenshots/recordings.png" width="240" alt="Enregistrements">
  <img src="screenshots/rarities.png"   width="240" alt="Raretés">
  <img src="screenshots/favorites.png"  width="240" alt="Favoris">
</p>
</details>

<details>
<summary><b>Indicateurs</b> — Météo · Statistiques · Modèles · Analyses · Biodiversité · Phénologie · Saisons · Comparer</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Météo">
  <img src="screenshots/stats.png"        width="240" alt="Statistiques">
  <img src="screenshots/system-model.png" width="240" alt="Modèles">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversité">
  <img src="screenshots/phenology.png"    width="240" alt="Phénologie">
  <img src="screenshots/comparison.png"   width="240" alt="Saisons">
  <img src="screenshots/compare.png"      width="240" alt="Comparer 2 espèces">
</p>
</details>

<details>
<summary><b>Station</b> — Santé système, réglages &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Santé système">
  <img src="screenshots/system-model.png"    width="240" alt="Moniteur des modèles">
  <img src="screenshots/system-data.png"     width="240" alt="Données système">
  <img src="screenshots/system-external.png" width="240" alt="Externe">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Détection">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Notifications">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Services">
  <img src="screenshots/settings-species.png"  width="240" alt="Espèces">
  <img src="screenshots/settings-backup.png"   width="240" alt="Sauvegarde">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architecture

> **[Documentation complète de l'architecture →](ARCHITECTURE.fr.md)** — référence technique détaillée : pipeline audio, schéma de base de données, performance, et plus.

```
Raspberry Pi 5 + SSD
├── Interface audio USB
│     ↓
├── BirdEngine (Python)
│   ├── Enregistrement (arecord → WAV 45s)
│   ├── Pipeline audio : Gain adaptatif → Passe-haut → Passe-bas
│   │   → Soustraction profil bruit → Normalisation RMS
│   ├── BirdNET V2.4    (~1.5s/fichier, primaire)
│   ├── Perch V2         (~0.7s/fichier sur Pi 5, secondaire)
│   ├── Extraction MP3 + spectrogrammes
│   └── Upload BirdWeather
│
├── Birdash (Node.js)
│   ├── API Dashboard (port 7474)
│   ├── Spectrogramme live (PCM + flux MP3)
│   ├── Notifications push via Apprise (100+ services)
│   ├── Validation des détections + auto-flagging
│   ├── Télémétrie (opt-in Supabase)
│   └── Signalement de bugs in-app (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (terminal web)
└── SQLite (1M+ détections)
```

## Fonctionnalités

### Moteur de détection (BirdEngine)
- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Inférence dual-modèle** — BirdNET V2.4 (~1.5s/fichier) + Perch V2 (~0.7s/fichier sur Pi 5) en parallèle. Variante du modèle auto-sélectionnée selon le Pi : FP32 sur Pi 5, FP16 sur Pi 4, INT8 sur Pi 3
- <img src="docs/icons/shield-check.svg" width="16" align="top" alt=""> **Confirmation bi-modèle** — les détections Perch sous un seuil standalone (défaut 0.85) doivent être confirmées par BirdNET (echo brut ≥ 0.15) sur un chunk qui se chevauche. Tue la majorité des faux positifs Perch sur le bruit basse fréquence (vent, véhicules → oies/hérons/corbeaux) sans perdre les espèces que BirdNET seul rate. 3 seuils ajustables dans Réglages → Détection avec tooltips (i)
- <img src="docs/icons/timer.svg" width="16" align="top" alt=""> **Limite par espèce (throttle)** — opt-in, cooldown par espèce (défaut 120 s) qui empêche les espèces dominantes (moineaux, merles…) de saturer la DB tout en laissant passer les détections de haute confiance (≥ seuil bypass, défaut 0.95). État en mémoire dans le moteur, hot-reload depuis `birdnet.conf`. Script `scripts/cleanup_throttle.py` pour purger rétroactivement l'historique avec `--dry-run` / `--apply`, backup DB et quarantaine audio — 60-70 % de purge typique sur stations bruyantes
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Enregistrement local** — interface USB via ALSA avec gain configurable
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Normalisation adaptative du bruit** — gain logiciel automatique selon le bruit ambiant, protection clipping, gel d'activité, mode observateur
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Filtres audio** — passe-haut + passe-bas (bandpass) configurables, réduction de bruit spectrale (gating stationnaire), normalisation RMS
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdWeather** — upload automatique des paysages sonores + détections
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Notifications push intelligentes** — via Apprise (ntfy, Telegram, Discord, Slack, email, 100+ services) avec photo de l'espèce, préfixe nom de station (`[Heinsch] Merle noir`). 5 règles configurables : espèces rares, première de saison, nouvelle espèce, première du jour, favoris
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Publicateur MQTT** — opt-in, publie chaque détection sur n'importe quel broker MQTT (Mosquitto, EMQX, HiveMQ…) sur `<prefix>/<station>/detection`, avec topic `last_species` retenu et statut online/offline LWT. **Auto-discovery Home Assistant** optionnelle qui crée automatiquement les entités `Last species` + `Last confidence`. QoS, retain, TLS, username/password, confiance minimum configurables — Test en un clic depuis les Réglages
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Endpoint Prometheus `/metrics`** — scrape `http://votre-pi.local/birds/metrics` depuis Prometheus / Grafana / VictoriaMetrics. Jauges custom (détections total/jour/dernière heure, espèces distinctes, âge dernière détection, taille DB), jauges système (température CPU, usage, RAM, disque, RPM ventilateur, uptime), toggles features, et métriques process Node.js standard. Rafraîchi paresseusement à chaque scrape
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Moniteur niveau sonore live (Leq / crête)** — RMS et crête en dBFS calculés par enregistrement, exposés sur `/metrics` (`birdash_sound_leq_dbfs`, `_peak_dbfs`, `_leq_1h_avg_dbfs`) et affichés en direct dans Réglages → Audio avec sparkline 60 points. Utile pour repérer vent, trafic, micro HS ou nuits silencieuses. Non calibré (suivi de tendance, pas SPL absolu). Alertes Apprise optionnelles quand le Leq moyen passe sous `-90 dBFS` pendant 15 min (micro silencieux) ou reste au-dessus de `-5 dBFS` (clipping)
- <img src="docs/icons/lock.svg" width="16" align="top" alt=""> **Authentification & contrôle d'accès** — sessions cookies opt-in (mono-utilisateur, bcrypt). 3 modes : `off` (LAN de confiance, défaut), `protected` (login pour tout), et **`public-read`** (le public peut consulter détections, espèces, stats — login requis uniquement pour modifier la config ou accéder aux données sensibles). Cookies HMAC signés, pas de table de sessions à gérer. Bearer token (`BIRDASH_API_TOKEN`) actif en parallèle pour cron/automation. Tentatives de login limitées 5/min/IP. Voir **[Exposer sur Internet](#exposer-sur-internet)** ci-dessous
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Filtre géographique** — filtre BirdNET MData (déjà actif, configurable via `SF_THRESH`) qui affiche maintenant la **liste live des espèces attendues à votre position pour la semaine en cours** (Réglages → Détection). Plus le **filtre eBird opt-in pour Perch** qui ignore les détections Perch absentes de la carte eBird "récemment observées" — Perch n'a pas de modèle géographique intégré et signale sinon des espèces tropicales en zone tempérée
- <img src="docs/icons/shield.svg" width="16" align="top" alt=""> **Filtres pré-analyse (YAMNet)** — **filtre vie privée** opt-in (ignore les détections + supprime optionnellement le WAV quand une voix humaine est détectée, RGPD-friendly par défaut) et **filtre aboiement de chien** (ignore les détections + cooldown quand un aboiement / hurlement / grognement est détecté — stoppe la cascade de faux positifs déclenchés par les chiens). Propulsé par YAMNet de Google (AudioSet, 521 classes audio, 4 MB TFLite, embarqué). Un modèle, deux filtres, ~30 ms de latence ajoutée par enregistrement sur Pi 5
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> **Digest éditorial hebdomadaire** — lundi 8h, 5 lignes éditorialisées via Apprise : nombres + delta vs N-1, highlight (rare > première de l'année > notable), meilleur moment, décalage phénologique, top 3 espèces. Opt-in, routage par tag optionnel
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Post-traitement async** — extraction MP3, génération de spectrogrammes, sync DB ne bloquent pas l'inférence

### Dashboard (20 pages)

**Accueil**
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Vue d'ensemble** (page d'atterrissage) — 6 KPIs (incl. heure première détection), alertes "What's New", contexte météo, activité horaire. Carte détection vedette avec deux onglets : **Dernière détection** (signal station-alive) et **Meilleure du jour** (pick de plus haute confiance)
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Aujourd'hui** — liste d'espèces avec tri (count / première écoutée / max conf / nouveauté) et pills count/confidence séparées. **Résumé interprétatif** par espèce (statut déterministe unique : à valider / faible isolée / burst isolé / haute confiance répétée / surtout active à l'aube / présente toute la journée). Spectrogramme avec **overlay bande de fréquence attendue** (~95 espèces, basculable). Player audio avec filtres gain/HP/LP. Deep-link direct vers **Validation** avec espèce + date pré-filtrées
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Traduction des noms d'espèces** — noms d'oiseaux affichés dans la langue choisie sur toutes les pages

**En direct**
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Bird Flow** — pipeline animé montrant les niveaux audio live (SSE), inférence dual-modèle avec espèces + confidence par modèle, flux de détection avec connecteurs animés, KPIs du jour, fil d'événements clés
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Spectrogramme live** — audio temps réel du micro avec overlay nom d'oiseau
- <img src="docs/icons/scroll-text.svg" width="16" align="top" alt=""> **Log live** — dashboard streaming temps réel (SSE) avec catégories colorées, KPIs, pause/reprise
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> **Live Board** — affichage kiosque plein écran pour un écran dédié : grande photo d'espèce, KPIs, liste des espèces du jour, météo, auto-rafraîchissement 30 s, bouton retour discret

**Historique**
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Calendrier** — grille mensuelle avec count espèces par jour, count détections, heatmap d'activité, badges nouvelles espèces (★) et raretés (◆). Clic sur une cellule avec badges pour voir popover photos + noms. Clic sur n'importe quel jour pour ouvrir la vue détaillée
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — timeline pleine page interactive avec drag-to-zoom, slider densité unifié (0-100%), icônes SVG lever/coucher de soleil/lune, badges filtres avec clignotement, disposition verticale par confiance
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Détections** — table filtrable complète avec favoris, filtre nouvelle espèce, suppression par détection, export CSV/eBird
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Validation** — détections auto-flaggées avec spectro-modal, confirm/reject/delete en masse avec preview, purge des rejetées

**Espèces**
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> Fiches espèces avec photos (iNaturalist + Wikipedia), statut UICN, favoris (SQLite), notes personnelles (par espèce et par détection), calendrier phénologique (12-mois dot map), comparaison annuelle mensuelle, export PNG des charts, Web Share API
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favoris** — page dédiée avec KPIs, recherche, tri ; toggle cœur sur toutes les listes d'espèces
- <img src="docs/icons/gem.svg" width="16" align="top" alt=""> **Raretés** — KPI cards cliquables pleine largeur, table filtrable (vues une fois / nouvelles cette année), liste détaillée d'espèces avec photos et badges de confiance
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Enregistrements** — bibliothèque audio unifiée avec deux onglets : "Bibliothèque" (tous les enregistrements, triables/filtrables) et "Meilleurs" (top enregistrements groupés par espèce)

**Indicateurs**
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Météo** — analyse de corrélation Open-Meteo (Pearson r), prévision du lendemain, plus analytique ornithologique complète : 4 leaderboards (tolérance au froid · siffleurs d'orage · pluie battante · vent fort), heatmap espèces × température (top 30, bins -15…+35 °C), et carte de recherche personnalisée live avec 6 dimensions filtrables (temp, précip, vent, heure, période, conditions) — répond à "quelles espèces restent actives en gel ?" en un clic. Filtres partageables via URL, export CSV
- <img src="docs/icons/thermometer.svg" width="16" align="top" alt=""> **Contexte météo par détection** — chaque détection est taggée avec un snapshot horaire (temp, humidité, vent, précip, nuages, pression, code WMO) via le worker `weather-watcher` interrogeant Open-Meteo. Puces météo compactes sur `today`, `overview`, `recordings`, `rarities`, `review`, `favorites` et dans la modale spectrogramme. Panneau "Profil météo" par espèce sur `species.html` avec stats (temp moyenne, plage, % sous précipitations) et histogrammes. Backfill complet via l'API archive Open-Meteo (gratuite, sans clé)
- <img src="docs/icons/trending-up.svg" width="16" align="top" alt=""> **Statistiques** — classements, records, distributions, évolution annuelle ; onglet **Modèles** intégré pour comparaison dual-modèle (chart quotidien, espèces exclusives, analyse de chevauchement)
- <img src="docs/icons/microscope.svg" width="16" align="top" alt=""> Analyses avancées (diagrammes polaires, heatmaps, séries temporelles, narratif)
- <img src="docs/icons/dna.svg" width="16" align="top" alt=""> Biodiversité — indice de Shannon, chart de richesse adaptatif, heatmap taxonomique
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Calendrier phénologique** — cycle annuel observé par espèce (modes présence/abondance/horaire), phases inférées (période d'activité, pic d'abondance, chœur de l'aube, détection migrant), visualisation ribbon 53-semaines, suggestions sur état vide
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Saisons** — rapport ornithologique saisonnier (printemps/été/automne/hiver). Arrivées migratoires avec comparaison vs année précédente (plus tôt/plus tard), départs, espèces exclusives à la saison, chart d'évolution multi-année, meilleurs jours, top espèces avec delta année/année
- <img src="docs/icons/git-compare.svg" width="16" align="top" alt=""> **Comparer** — désambiguation côte à côte de 2 espèces. Cartes d'identité, verdict déterministe (pas assez de données / confusion modèle possible / forte séparation saisonnière / profils distincts), overlay activité 24h, overlay phénologie hebdomadaire, histogramme de confiance, badge fiabilité. Paires "souvent confondues" hardcodées (Pouillot véloce/fitis, Mésange nonnette/boréale…)

**Navigation**
- 6 sections par intention : Accueil, En direct, Historique, Espèces, Indicateurs, Station
- Nav mobile en bas (4 raccourcis + drawer hamburger avec les 20 pages)
- Recherche globale espèce+date, cloche notifications, badge compteur validation
- Raccourcis clavier sur 5 pages, gestes swipe sur les photos d'espèces
- States de chargement skeleton pour les pages data-heavy
- Cross-navigation entre settings et pages système

### Wizard de configuration au premier lancement
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **Modal 7 étapes hardware-aware** — auto-déclenché à l'install fraîche (pas de flag setup, lat/lon=0). Détecte modèle Pi, RAM, cartes son, disques, internet via `/api/setup/hardware-profile` et propose des défauts adaptés. Étapes : Bienvenue (avec aperçu hardware détecté) → Localisation → Source audio (badge USB-recommandé) → Modèle (Single/Dual selon hardware) → Pré-filtres (privacy + chien) → Intégrations (BirdWeather, Apprise) → Récap. **Applique la config sur disque sans redémarrer aucun service** — détections en cours jamais interrompues, l'utilisateur redémarre le moteur quand prêt. Rejouable à tout moment depuis Réglages → Station → "Lancer le wizard". Auto-skip après première complétion via `config/setup-completed.json`. Disponible en 4 langues.

### Validation des détections
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Auto-flagging** — oiseaux nocturnes en journée, migrateurs hors saison, faible confiance isolée, espèces non-européennes
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Actions en masse** — confirm/reject/delete par règle, par sélection, ou purge de tous les rejetés
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> Spectrogramme modal complet avec filtres gain/passe-haut/passe-bas et sélection de boucle pour vérification manuelle
- <img src="docs/icons/trash-2.svg" width="16" align="top" alt=""> **Suppression définitive** — modal d'aperçu listant ce qui sera supprimé (DB + fichiers audio), avec rapport de résultat

### Configuration audio
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> Auto-détection des périphériques USB audio avec sélection en un clic
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Gain adaptatif** — estimation noise floor, protection clipping, gel d'activité, modes observateur/application
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Bandpass + débruitage** — passe-haut (50-300 Hz), passe-bas (4-15 kHz), gating spectral (noisereduce), tout activable par profil
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Profil de bruit ambiant** — enregistre 5 s de bruit de fond (autoroute, HVAC), utilisé pour soustraction spectrale ciblée via noisereduce `y_noise` — plus efficace que l'auto-denoise pour les sources de bruit constantes
- <img src="docs/icons/eye.svg" width="16" align="top" alt=""> **Prévisualisation des filtres** — spectrogrammes avant/après depuis le micro live pour visualiser l'effet de chaque filtre dont le profil de bruit
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Pipeline audio** — Mic → Gain adaptatif → Passe-haut → Passe-bas → Profil de bruit (ou auto denoise) → Normalisation RMS → BirdNET + Perch — diagramme visuel du pipeline dans les Réglages
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> 6 profils d'environnement (jardin, forêt, bord de route, ville, nuit, test)
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> Wizard de calibration inter-canaux pour micros EM272 doubles
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> VU-mètres temps réel via SSE

### Réseau communautaire
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdStation Network** — communauté opt-in de stations partageant un résumé quotidien des détections via Supabase
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **[Carte des stations live](https://ernens.github.io/birdash-network/)** — toutes les stations enregistrées sur une carte interactive thème sombre
- <img src="docs/icons/bug.svg" width="16" align="top" alt=""> **Signalement de bug in-app** — soumets des issues directement à GitHub depuis le header du dashboard, avec attachement de logs optionnel (dernière heure de logs services incluse dans l'issue)

### Réglages & système
- <img src="docs/icons/wrench.svg" width="16" align="top" alt=""> Interface complète — modèles (download BirdNET en un clic avec acceptation de licence), paramètres d'analyse, notifications, audio, sauvegarde
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **Carte GPS interactive** — widget Leaflet/OpenStreetMap dans les réglages station avec clic-pour-définir, drag du marqueur, et bouton géolocalisation
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> Santé système — CPU, RAM, disque, température, services
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Terminal web** — bash complet dans le navigateur, supporte Claude Code
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Sauvegarde** — NFS/SMB/SFTP/S3/GDrive/WebDAV avec planification
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **12 thèmes** — 7 sombres (Forêt, Nuit, Océan, Crépuscule, Solar Dark, Nord, High Contrast AAA), 4 clairs (Papier, Sépia, Solar Light, Colonial), plus un mode **Auto** qui suit le `prefers-color-scheme` de l'OS. Mini aperçus de page dans le sélecteur, fondu doux entre thèmes, système de design entièrement par tokens (voir [`docs/THEMES.md`](docs/THEMES.md))
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Gestion photos** — bannir/remplacer photos, définir la photo préférée par espèce
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Branding personnalisable** — nom de station et brand header configurables via les réglages
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 langues UI (FR/EN/NL/DE) + 36 langues pour les noms d'espèces
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> **Unités et formats locaux** — auto-détectés depuis la locale du navigateur (°C/°F, km/h/mph, 12h/24h, JMA/MJA/ISO, lundi/dimanche), surchargeables dans Réglages → Station

## Modèles Perch V2 optimisés

Nous publions **3 variantes de Perch V2 TFLite** optimisées pour le déploiement edge, converties depuis le SavedModel officiel de Google :

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** sur HuggingFace

| Modèle | Taille | Latence (Pi 5) | Top-1 | Top-5 | Idéal pour |
|--------|--------|----------------|-------|-------|------------|
| `perch_v2_original.tflite` | 409 MB | 435 ms | référence | référence | **Pi 5** (défaut) |
| `perch_v2_fp16.tflite` | 205 MB | 384 ms | 100% | 99% | **Pi 4** (défaut) |
| `perch_v2_dynint8.tflite` | 105 MB | 299 ms | 93% | 90% | **Pi 3** (défaut) |

Benchmarké sur Raspberry Pi 5 (8 Go, Cortex-A76 @ 2.4 GHz), 20 vrais enregistrements de 20 espèces, 5 runs chacun, 4 threads. L'installeur sélectionne automatiquement la variante optimale pour ton modèle de Pi.

## Matériel

| Composant | Recommandé |
|-----------|------------|
| SBC | Raspberry Pi 5 (8 Go) recommandé — fonctionne aussi sur Pi 4 (4 Go+) et Pi 3 (1 Go, modèles INT8 uniquement) |
| Stockage | SSD NVMe (500 Go+) |
| Audio | Toute interface USB (ex : RODE AI-Micro, Focusrite Scarlett, Behringer UMC, UGreen 30724) + microphone |
| Réseau | Ethernet ou WiFi |

## Exposer sur Internet

Par défaut birdash fait confiance au LAN — n'importe qui sur `192.168.x.x` peut changer les réglages. Pour montrer ta station à des amis ou l'embed sur un site public en sécurité :

1. **Active l'auth.** Dans **Réglages → Station → Sécurité**, choisis un mode :
   - **`Public read-only`** ⭐ — les visiteurs peuvent consulter détections, espèces, stats, audio. Login requis pour modifier la config, éditer des détections, ou voir les logs. **Recommandé pour le partage public.**
   - **`Protected`** — login requis pour tout.

   Définis un username + password (8 chars min, hashé bcrypt dans `birdnet.conf`). Tentatives de login limitées 5/min/IP.

2. **Reverse-tunnel via Cloudflare** (pas de port-forwarding, TLS gratuit, masque ton IP domestique) :

   ```bash
   # Sur ton Pi
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb

   # Login + créer un tunnel
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

   Ta station est maintenant accessible sur `https://birds.example.com/birds/` avec TLS de bout en bout, aucun port ouvert sur ton routeur, et Cloudflare devant tout abus.

3. **Le Bearer token reste actif.** Si tu utilises aussi `BIRDASH_API_TOKEN` pour cron/automation, ça marche en parallèle — utilise le header `Authorization: Bearer <token>` au lieu de te logger.

Alternatives : Tailscale Funnel, ngrok, port-forward + Caddy avec Let's Encrypt — birdash s'en fiche du transport tant que quelque chose termine TLS devant.

## Prérequis

- Raspberry Pi 3/4/5 avec Raspberry Pi OS 64-bit (Bookworm/Trixie) — Pi 5 recommandé pour dual-modèle
- Connexion internet (pour setup initial et téléchargement modèles)
- Interface audio USB + microphone(s)
  - Les micros lavalier (clip-on) avec prise **TRRS** nécessitent un **adaptateur TRRS→TRS** pour les cartes son USB standards
  - L'installeur configure ALSA automatiquement avec un boost gain logiciel pour les micros USB peu sensibles

Toutes les autres dépendances sont installées automatiquement par l'installeur.

## Installation

### Installation en une commande (recommandée)

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

C'est tout. Le bootstrap installe git si nécessaire, clone le repo dans `~/birdash`, lance `install.sh` non-interactif, télécharge le modèle BirdNET V2.4, active la détection dual-modèle (BirdNET + Perch), et démarre tous les services. À la fin, ouvre l'URL du dashboard imprimée et règle GPS/audio depuis **Réglages**.

BirdNET V2.4 est sous **CC-BY-NC-SA 4.0** (usage non-commercial — voir le [repo BirdNET-Analyzer](https://github.com/kahst/BirdNET-Analyzer)). Pour sauter le téléchargement BirdNET et utiliser Perch seul :

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | BIRDASH_SKIP_BIRDNET=1 bash
```

### Installation manuelle

```bash
# 1. Clone et install
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh                # interactif
# ou : ./install.sh --yes   # non-interactif

# 2. Démarre tous les services
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd

# 3. Ouvre le dashboard et configure
#    → Réglages → Station : définir GPS via carte interactive
#    → Réglages → Détection : télécharger BirdNET V2.4 (un clic)
#    → Réglages → Audio : sélectionner le périphérique USB
```

L'installeur gère tout : paquets système, Caddy, ttyd, bases de données, modèles Perch V2 (auto-téléchargés depuis HuggingFace, variante adaptée à ton modèle de Pi), services, et tâches cron. BirdNET V2.4 s'installe via le dashboard (acceptation licence CC-NC-SA requise).

Ton dashboard sera disponible sur `http://votrepi.local/birds/`

## Mise à jour

### Mise à jour in-app (recommandée)

Quand une nouvelle version est disponible, un bandeau rouge apparaît en haut de chaque page avec le vrai semver (ex `v1.7.0 → v1.7.3`). Clique **Voir** pour les release notes catégorisées, puis :

- **Installer maintenant** — applique la mise à jour, redémarre les services avec health-check, recharge la page
- **Plus tard (24h)** — snooze le bandeau pendant 24 heures
- **Skip ces updates** — masque jusqu'à ce qu'une version plus récente soit publiée

En cas d'échec :
- **Rollback** — revient à la version précédente (apparaît si `previousCommit` connu)
- **Forcer l'update** — force même avec historique divergé ou fichiers sales
- **Voir le log** — viewer log dépliable pour debug

En cas de succès : message de confirmation, page rechargée après 2 secondes.

### Mise à jour distante via SSH

```bash
ssh user@votrepi.local 'bash ~/birdash/scripts/update.sh'
```

### Fan-out vers plusieurs stations

```bash
for h in mickey donald papier; do
  ssh "$h.local" 'bash ~/birdash/scripts/update.sh'
done
```

## Tests

```bash
# Tests backend Node.js (160 tests dont cohérence cross-pages)
npm test

# Tests Python du moteur (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v

# Smoke test — charge chaque page dans un browser headless, capture pageerror
# + console.error + 5xx, exit non-zero sur tout échec. Attrape les régressions
# silencieuses que les runs screenshot-only ratent (JS cassé, icônes manquantes,
# pages qui ne montent pas).
npm run smoke                       # local
npm run smoke http://biloute.local  # contre n'importe quelle station Pi

# Rafraîchit les screenshots du README (thème Paper, EN, 1440x900)
npm run screenshots
```

## Télémétrie & vie privée

BirdStation a deux couches de télémétrie indépendantes :

**Pings d'usage anonymes** (opt-out) — activés par défaut, désactivables dans Réglages → Station :
- Envoie un ping mensuel avec : `version`, `modèle Pi`, `OS`, `pays`
- **Aucun** GPS, UUID, nom de station, IP, ou autre donnée personnelle
- Les événements install et update sont aussi enregistrés (mêmes données anonymes)
- Nous aide à suivre l'adoption et savoir quelles plateformes prioriser
- Désactivable à tout moment dans Réglages → Station → "Statistiques d'usage anonymes"

**Réseau communautaire** (opt-in) — désactivé par défaut :
- Enregistre ta station sur la [carte live](https://ernens.github.io/birdash-network/) avec GPS + nom de station
- Envoie un résumé quotidien des détections (top espèces, espèces rares)
- Activer dans Réglages → Station → "Rejoindre le réseau"

Les deux couches utilisent Supabase avec une clé anon publique (RLS write-only). Aucune donnée n'est collectée jusqu'au démarrage du service, et les pings anonymes sont entièrement désactivables.

## Communauté

- **[Carte des stations live](https://ernens.github.io/birdash-network/)** — voir toutes les BirdStation enregistrées dans le monde
- **[Signaler un bug](https://github.com/ernens/birdash/issues)** — ou utilise le bouton bug in-app (icône bug rouge dans le header)
- **[Discussions](https://github.com/ernens/birdash/discussions)** — questions, idées, montrez votre setup

## Licence

[MIT](LICENSE)
