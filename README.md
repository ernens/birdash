# BirdBoard

Dashboard ornithologique moderne pour BirdNET-Pi.
Interface HTML/JS avec backend Node.js, multilingue (FR/EN/NL).

## Fonctionnalites

- Vue d'ensemble avec KPIs et graphiques
- Feed des detections avec lecture audio
- Fiches especes detaillees
- Matrice biodiversite
- Especes rares
- Statistiques et classements
- Etat du systeme
- Analyses avancees

## Prerequis

- BirdNET-Pi en fonctionnement (`~/BirdNET-Pi/scripts/birds.db` present)
- Node.js >= 18 (`node --version`)
- Caddy (voir section Configuration Caddy ci-dessous)

## Installation

```bash
# 1. Cloner le depot
cd ~
git clone https://github.com/ernens/BirdBoard.git pibird

# 2. Installer la dependance backend
cd ~/pibird
npm install better-sqlite3

# 3. Adapter la configuration
#    Editer bird-config.js selon votre installation :
#    - location (coordonnees, nom)
#    - defaultLang (fr, en ou nl)
nano bird-config.js

# 4. Tester le serveur manuellement
node bird-server.js
# -> [PIBIRD] API demarree sur http://127.0.0.1:7474
# Test : curl http://127.0.0.1:7474/api/health

# 5. Installer le service systemd
sudo cp pibird-api.service /etc/systemd/system/
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

# Ouvrir le dashboard dans un navigateur
# http://VOTRE_HOSTNAME/birds/
```

## Structure des fichiers

```
~/pibird/
├── bird-server.js        # Backend Node.js/Express (port 7474)
├── bird-config.js        # Configuration (localisation, langue, seuils)
├── bird-i18n.js          # Traductions (fr/en/nl)
├── bird-core.js          # Utilitaires partages
├── bird-styles.css       # Theme visuel
├── index.html            # Vue d'ensemble
├── detections.html       # Feed detections + audio
├── especes.html          # Fiche par espece
├── biodiversite.html     # Matrice biodiversite
├── rarites.html          # Especes rares
├── stats.html            # Statistiques
├── analyses.html         # Analyses avancees
├── systeme.html          # Etat du systeme
├── pibird-api.service    # Service systemd
└── caddy-snippet.txt     # Extrait de config Caddy
```

## Variables d'environnement (optionnel)

```bash
PIBIRD_PORT=7474
PIBIRD_DB=/home/{USER}/BirdNET-Pi/scripts/birds.db
```

## Mise a jour

```bash
cd ~/pibird
git pull
# Redemarrer le service si bird-server.js a change
sudo systemctl restart pibird-api
```
