#!/bin/bash
# tft-install.sh — configure the Adafruit PiTFT 3.5" (HX8357D + STMPE610)
# so birdash can render to /dev/fb1. Idempotent: safe to run multiple times.
#
# What it does:
#   1. Enables SPI (raspi-config)
#   2. Adds dtoverlay=pitft35-resistive to /boot/firmware/config.txt (once)
#   3. Installs python3-pil and python3-numpy
#   4. Installs and enables birdash-tft.service
#
# Does NOT reboot. Prints "REBOOT_REQUIRED" if a reboot is needed.
set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_SRC="$PROJECT_ROOT/tft-display/birdash-tft.service"
SERVICE_DST="/etc/systemd/system/birdash-tft.service"
CONFIG_TXT="/boot/firmware/config.txt"
[ -f "$CONFIG_TXT" ] || CONFIG_TXT="/boot/config.txt"

log() { echo "[tft-install] $*"; }

reboot_needed=0

log "Enabling SPI…"
if raspi-config nonint do_spi 0 >/dev/null 2>&1; then
  log "  SPI enabled."
  # raspi-config doesn't always take effect until next boot.
  [ -e /dev/spidev0.0 ] || reboot_needed=1
else
  log "  raspi-config not available — skipping (check SPI manually)."
fi

log "Ensuring pitft35-resistive overlay in $CONFIG_TXT…"
if grep -q "^dtoverlay=pitft35-resistive" "$CONFIG_TXT" 2>/dev/null; then
  log "  Overlay already present."
else
  echo "" >> "$CONFIG_TXT"
  echo "# Added by birdash tft-install.sh" >> "$CONFIG_TXT"
  echo "dtoverlay=pitft35-resistive,rotate=90,speed=32000000,fps=25" >> "$CONFIG_TXT"
  log "  Overlay added."
  reboot_needed=1
fi

log "Installing python3-pil + python3-numpy…"
if ! dpkg -s python3-pil >/dev/null 2>&1 || ! dpkg -s python3-numpy >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3-pil python3-numpy >/dev/null 2>&1 || {
    log "  apt install failed — check network or install manually."
  }
else
  log "  Already installed."
fi

log "Installing systemd unit…"
if [ ! -f "$SERVICE_SRC" ]; then
  log "  ERROR: $SERVICE_SRC missing. Aborting."
  exit 1
fi
# Match the user birdash.service runs as — keeps file perms sane and avoids
# needing a dedicated system user just for the renderer.
BIRDASH_USER=$(systemctl show -p User --value birdash.service 2>/dev/null)
[ -z "$BIRDASH_USER" ] && BIRDASH_USER="bjorn"
tmp_unit=$(mktemp)
sed "s/^User=.*/User=${BIRDASH_USER}/" "$SERVICE_SRC" > "$tmp_unit"
if ! cmp -s "$tmp_unit" "$SERVICE_DST" 2>/dev/null; then
  cp "$tmp_unit" "$SERVICE_DST"
  rm -f "$tmp_unit"
  systemctl daemon-reload
  log "  Unit installed (User=${BIRDASH_USER}) and daemon reloaded."
else
  rm -f "$tmp_unit"
  log "  Unit already up to date."
fi
systemctl enable birdash-tft.service >/dev/null 2>&1 && log "  Service enabled at boot."

# Only start now if the framebuffer is already present (otherwise we'd loop on
# a missing /dev/fb1 and write hundreds of errors to the log).
if [ -e /dev/fb1 ]; then
  systemctl restart birdash-tft.service && log "  Service restarted."
else
  log "  /dev/fb1 not yet present — service will start after reboot."
  reboot_needed=1
fi

if [ "$reboot_needed" = "1" ]; then
  log "Done. REBOOT_REQUIRED"
  exit 10
fi

log "Done. No reboot needed."
exit 0
