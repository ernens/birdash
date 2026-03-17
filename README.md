# BirdBoard

Dashboard ornithologique moderne pour [BirdNET-Pi](https://github.com/mcguirepr89/BirdNET-Pi).
Interface Vue 3 (CDN) avec backend Node.js, multilingue (FR/EN/NL).

> [English version](README.en.md)

## Fonctionnalites

- Vue d'ensemble avec KPIs et graphiques temps reel
- Feed des detections avec lecture audio integree
- Fiches especes detaillees avec photos (iNaturalist)
- Matrice biodiversite (heures x especes)
- Especes rares et alertes
- Statistiques et classements
- Spectrogramme audio
- Enregistrements recents avec lecteur
- Etat du systeme (CPU, RAM, disque, temperature)
- Analyses avancees
- Service Worker pour cache offline
- Accessibilite (WCAG AA, navigation clavier, skip-link)

## Prerequis

- BirdNET-Pi en fonctionnement (`~/BirdNET-Pi/scripts/birds.db` present)
- Node.js >= 18 (`node --version`)
- Caddy (voir section Configuration Caddy ci-dessous)

## Installation

```bash
# 1. Cloner le depot
cd ~
git clone https://github.com/ernens/BirdBoard.git pibird

# 2. Installer les dependances
cd ~/pibird
npm install

# 3. Adapter la configuration
#    Editer bird-config.js selon votre installation :
#    - location (coordonnees, nom)
#    - defaultLang (fr, en ou nl)
nano bird-config.js

# 4. Configuration locale (optionnel)
#    Copier le template et renseigner vos cles API
cp pibird-local.example.js pibird-local.js
nano pibird-local.js

# 5. Tester le serveur manuellement
node bird-server.js
# -> [PIBIRD] API demarree sur http://127.0.0.1:7474
# Test : curl http://127.0.0.1:7474/api/health

# 6. Lancer les tests
npm test

# 7. Installer le service systemd
sudo cp pibird-api.service /etc/systemd/system/
#    Editer le service pour ajouter vos cles API (EBIRD_API_KEY, BW_STATION_ID)
sudo systemctl edit pibird-api
sudo systemctl daemon-reload
sudo systemctl enable pibird-api
sudo systemctl start pibird-api
sudo systemctl status pibird-api
```

## Configuration Caddy

BirdBoard utilise Caddy comme reverse proxy pour servir l'API, les fichiers
audio et les pages statiques sous un meme chemin `/birds/`.

### 1. Installer Caddy (si pas deja installe)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. Configurer le Caddyfile

Editez `/etc/caddy/Caddyfile` et ajoutez le bloc BirdBoard dans votre
configuration de site. Remplacez `VOTRE_HOSTNAME` par le nom de votre
machine (ex: `raspberrypi.local`, `monpi.local`, ou une adresse IP).

```
VOTRE_HOSTNAME {
    encode zstd gzip

    # ── BirdBoard ──────────────────────────────────────

    # API : proxy vers le backend Node.js
    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy 127.0.0.1:7474
    }

    # Audio : sert les fichiers audio extraits par BirdNET-Pi
    handle /birds/audio/* {
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }

    # Pages statiques du dashboard
    handle /birds* {
        root * /home/{USER}/pibird
        file_server
        try_files {path} /birds/index.html
    }

    # ... vos autres configurations ...
}
```

Remplacez `{USER}` par votre nom d'utilisateur systeme (ex: `pi`, `bjorn`).

### 3. Appliquer la configuration

```bash
# Verifier la syntaxe
caddy validate --config /etc/caddy/Caddyfile

# Recharger Caddy
sudo systemctl reload caddy
```

## Verification

```bash
# Tester l'API
curl http://127.0.0.1:7474/api/health

# Lancer les tests backend (19 tests)
npm test

# Ouvrir le dashboard dans un navigateur
# http://VOTRE_HOSTNAME/birds/
```

## Structure des fichiers

```
~/pibird/
├── bird-server.js           # Backend Node.js HTTP natif (port 7474)
├── bird-server.test.js      # Tests backend (19 tests, Node test runner)
├── bird-config.js           # Configuration (localisation, langue, seuils)
├── bird-i18n.js             # Traductions (fr/en/nl)
├── bird-core.js             # Utilitaires partages (fetch, formatage)
├── bird-vue-core.js         # Composants Vue 3 (PibirdShell, escHtml)
├── bird-styles.css          # Theme visuel global (clair/sombre/paper)
├── bird-pages.css           # Styles specifiques par page
├── sw.js                    # Service Worker (cache offline)
├── favicon.svg              # Icone du site
├── robin-logo.svg           # Logo BirdBoard
├── fr.json / en.json / nl.json  # Fichiers de traduction
│
├── index.html               # Vue d'ensemble
├── today.html               # Aujourd'hui (EN)
├── recent.html              # Detections recentes (EN)
├── detections.html          # Feed detections + audio
├── recordings.html          # Enregistrements (EN)
├── species.html             # Fiche espece (EN)
├── biodiversity.html        # Matrice biodiversite (EN)
├── rarities.html            # Especes rares (EN)
├── spectrogram.html         # Spectrogramme (EN)
├── stats.html               # Statistiques
├── analyses.html            # Analyses avancees
├── system.html              # Etat du systeme (EN)
│
├── aujourd-hui.html         # Aujourd'hui (FR)
├── especes.html             # Fiche espece (FR)
├── biodiversite.html        # Matrice biodiversite (FR)
├── rarites.html             # Especes rares (FR)
├── systeme.html             # Etat du systeme (FR)
│
├── pibird-api.service       # Service systemd
├── pibird-local.example.js  # Template config locale (cles API)
├── caddy-snippet.txt        # Extrait de config Caddy
├── package.json             # Dependances et scripts npm
└── PATCH-config-nav.txt     # Notes de patch
```

## Variables d'environnement

```bash
# Obligatoires (dans pibird-api.service ou shell)
PIBIRD_PORT=7474
PIBIRD_DB=/home/{USER}/BirdNET-Pi/scripts/birds.db

# Optionnelles (dans pibird-local.js ou systemd override)
EBIRD_API_KEY=your_ebird_api_key
BW_STATION_ID=your_birdweather_station_id
```

## Securite

- Rate limiting : 120 requetes/min par IP
- Validation SQL stricte (lecture seule, pas de multi-requetes)
- Headers de securite (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- CORS restreint aux origines configurees
- SRI (Subresource Integrity) sur les scripts CDN
- Protection XSS (echappement HTML)
- Masquage des erreurs SQL dans les reponses API

## Mise a jour

```bash
cd ~/pibird
git pull
npm install
# Redemarrer le service si bird-server.js a change
sudo systemctl restart pibird-api
```

## Licence

MIT
