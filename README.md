# PIBIRD — Installation

Dashboard ornithologique HTML/JS pour BirdNET-Pi.

## Prérequis
- BirdNET-Pi en fonctionnement (`~/BirdNET-Pi/scripts/birds.db` présent)
- Node.js ≥ 18 (`node --version`)
- Caddy déjà configuré (projet solar)

## Installation

```bash
# 1. Copier les fichiers dans ~/pibird/
mkdir -p ~/pibird
cp -r /chemin/vers/pibird/* ~/pibird/

# 2. Installer la dépendance backend
cd ~/pibird
npm install better-sqlite3

# 3. Tester le serveur manuellement
node bird-server.js
# → [PIBIRD] API démarrée sur http://127.0.0.1:7474
# Test : curl http://127.0.0.1:7474/api/health

# 4. Installer le service systemd
sudo cp pibird-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pibird-api
sudo systemctl start pibird-api
sudo systemctl status pibird-api

# 5. Ajouter la config Caddy (voir caddy-snippet.txt)
sudo nano /etc/caddy/Caddyfile
# Coller le contenu de caddy-snippet.txt
sudo systemctl reload caddy
```

## Vérification

```bash
# API
curl http://127.0.0.1:7474/api/health

# Page d'accueil
# Ouvrir http://biloute.local/birds/
```

## Structure des fichiers

```
~/pibird/
├── bird-server.js        # Backend Express (port 7474)
├── bird-config.js        # Configuration
├── bird-i18n.js          # Traductions (fr/en/nl)
├── bird-core.js          # Utilitaires partagés
├── bird-styles.css       # Thème visuel
├── index.html            # Vue d'ensemble
├── detections.html       # Feed détections + audio
├── especes.html          # Fiche par espèce
├── biodiversite.html     # Matrice biodiversité
├── rarites.html          # Espèces rares
├── stats.html            # Statistiques
├── systeme.html          # État du système
└── pibird-api.service    # Systemd service
```

## Variables d'environnement (optionnel)

```bash
PIBIRD_PORT=7474
PIBIRD_DB=/home/pi/BirdNET-Pi/scripts/birds.db
```

## Mise à jour

Remplacer les fichiers HTML/JS/CSS — le service backend n'a pas besoin d'être redémarré
sauf si `bird-server.js` est modifié.
