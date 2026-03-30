#!/bin/bash
# Birdash — Installation script
# Configures services and paths for the current user

set -e

BIRDASH_USER=$(whoami)
BIRDASH_HOME=$(eval echo ~$BIRDASH_USER)
BIRDASH_DIR="$BIRDASH_HOME/birdash"

echo "=== Birdash Installer ==="
echo "User: $BIRDASH_USER"
echo "Home: $BIRDASH_HOME"
echo "Birdash: $BIRDASH_DIR"
echo ""

# Check prerequisites
command -v node >/dev/null || { echo "ERROR: Node.js not found. Install with: sudo apt install nodejs npm"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: Python3 not found."; exit 1; }
command -v ffmpeg >/dev/null || { echo "WARNING: ffmpeg not found. Install with: sudo apt install ffmpeg"; }
command -v arecord >/dev/null || { echo "WARNING: arecord not found. Install with: sudo apt install alsa-utils"; }

# 1. Install Node.js dependencies
echo "[1/6] Installing Node.js dependencies..."
cd "$BIRDASH_DIR"
npm install --production

# 2. Create Python venv for BirdEngine
echo "[2/6] Setting up Python virtual environment..."
python3 -m venv "$BIRDASH_DIR/engine/venv"
"$BIRDASH_DIR/engine/venv/bin/pip" install --upgrade pip
"$BIRDASH_DIR/engine/venv/bin/pip" install ai-edge-litert numpy soundfile resampy toml watchdog

# 3. Create directories
echo "[3/6] Creating directories..."
mkdir -p "$BIRDASH_DIR/engine/audio/incoming"
mkdir -p "$BIRDASH_DIR/engine/audio/processed"
mkdir -p "$BIRDASH_DIR/engine/models"
mkdir -p "$BIRDASH_DIR/photo-cache"
mkdir -p "$BIRDASH_HOME/BirdSongs/Extracted/By_Date"
mkdir -p "$BIRDASH_HOME/BirdNET-Pi/scripts"

# 4. Generate config files from templates
echo "[4/6] Generating configuration files..."

if [ ! -f "$BIRDASH_DIR/engine/config.toml" ]; then
    sed "s|BIRDASH_HOME|$BIRDASH_HOME|g" "$BIRDASH_DIR/engine/config.toml.example" > "$BIRDASH_DIR/engine/config.toml"
    echo "  Created engine/config.toml — edit with your station location and API keys"
fi

if [ ! -f "$BIRDASH_DIR/public/js/birdash-local.js" ]; then
    cp "$BIRDASH_DIR/config/birdash-local.example.js" "$BIRDASH_DIR/public/js/birdash-local.js"
    echo "  Created public/js/birdash-local.js — edit with your location"
fi

# 5. Install systemd services
echo "[5/6] Installing systemd services..."
for svc in config/birdash.service engine/birdengine.service engine/birdengine-recording.service engine/ttyd.service; do
    svc_name=$(basename "$svc")
    sed -e "s|BIRDASH_USER|$BIRDASH_USER|g" -e "s|BIRDASH_HOME|$BIRDASH_HOME|g" \
        "$BIRDASH_DIR/$svc" | sudo tee "/etc/systemd/system/$svc_name" > /dev/null
    echo "  Installed $svc_name"
done
sudo systemctl daemon-reload

# 6. Download models (if not present)
echo "[6/6] Checking models..."
if [ ! -f "$BIRDASH_DIR/engine/models/Perch_v2_int8.tflite" ]; then
    echo "  Downloading Perch V2 INT8 from HuggingFace (~389 MB)..."
    wget -q --show-progress -O "$BIRDASH_DIR/engine/models/Perch_v2_int8.tflite" \
        "https://huggingface.co/ernensbjorn/perch-v2-int8-tflite/resolve/main/Perch_v2_int8.tflite" || \
        echo "  WARNING: Download failed. Download manually from https://huggingface.co/ernensbjorn/perch-v2-int8-tflite"
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit engine/config.toml with your station location, BirdWeather ID, ntfy URL"
echo "  2. Edit public/js/birdash-local.js with your location and eBird API key"
echo "  3. Copy BirdNET models to engine/models/ (or download from BirdNET-Pi)"
echo "  4. Configure Caddy reverse proxy (see README.md)"
echo "  5. Start services:"
echo "     sudo systemctl enable --now birdengine-recording birdengine birdash caddy"
echo ""
echo "  Dashboard: http://$(hostname).local/birds/"
