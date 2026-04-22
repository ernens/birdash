#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# Birdash — configure_zram.sh
#
# Auto-configures zram swap for low-RAM Raspberry Pi where BirdNET +
# Perch + Node + arecord can otherwise pressure memory and trigger
# OOM kills. Idempotent: safe to re-run.
#
# Sizing policy (zram = % of physical RAM, zstd-compressed):
#   Pi 3 / Pi 4 ≤ 2 GB    → 50 %
#   Pi 4         3-4 GB   → 25 %
#   Pi 4 / Pi 5 ≥ 6 GB    → SKIP — no benefit, just CPU cost
#                           (override with --force)
#
# Backends supported (auto-detected):
#   1. systemd-zram-generator  → modern (Bookworm/Trixie default), preferred
#   2. zram-tools              → legacy fallback
#
# Usage:
#   bash scripts/configure_zram.sh           # auto, prints decision
#   bash scripts/configure_zram.sh --force   # configure even on ≥6 GB
#   bash scripts/configure_zram.sh --status  # print current zram state, exit
#
# After install: status visible via `swapon -s`, `zramctl`, or this --status.
# ══════════════════════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

MODE_FORCE=0
MODE_STATUS=0
for arg in "$@"; do
    case "$arg" in
        --force)  MODE_FORCE=1 ;;
        --status) MODE_STATUS=1 ;;
    esac
done

show_status() {
    echo ""
    echo "── zram devices ───────────────────────────────────────"
    if command -v zramctl &>/dev/null && [ -e /dev/zram0 ]; then
        zramctl
    else
        info "no zram device active"
    fi
    echo ""
    echo "── swapon -s ──────────────────────────────────────────"
    swapon -s 2>/dev/null || info "no swap configured"
    echo ""
    echo "── backend ────────────────────────────────────────────"
    if dpkg -s systemd-zram-generator &>/dev/null; then
        info "systemd-zram-generator (modern)"
        ls /etc/systemd/zram-generator.conf 2>/dev/null && cat /etc/systemd/zram-generator.conf || info "(no /etc/systemd/zram-generator.conf — using defaults)"
    elif dpkg -s zram-tools &>/dev/null; then
        info "zram-tools (legacy)"
        cat /etc/default/zramswap 2>/dev/null | grep -v '^#' | grep -v '^$' || true
    else
        info "neither systemd-zram-generator nor zram-tools installed"
    fi
    echo ""
}

if [ "$MODE_STATUS" = "1" ]; then
    show_status
    exit 0
fi

# ── Detect host ─────────────────────────────────────────────────────────
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
RAM_MB=$((RAM_KB / 1024))
RAM_GB_INT=$(( (RAM_MB + 512) / 1024 ))

echo ""
echo -e "${GREEN}═══ Birdash — zram auto-config ════════════════════════${NC}"
info "Host: $PI_MODEL"
info "RAM : ${RAM_MB} MB (~${RAM_GB_INT} GB)"

# ── Decide ──────────────────────────────────────────────────────────────
if [ "$MODE_FORCE" = "0" ] && [ "$RAM_MB" -ge 5500 ]; then
    info "Skipping — ≥6 GB RAM, no memory pressure expected for birdash."
    info "Modern RPi OS already enables a small zram by default; nothing to do."
    info "Use --force to override."
    exit 0
fi

# Pick percentage
if [ "$RAM_MB" -le 2200 ]; then
    PERCENT=50
elif [ "$RAM_MB" -le 4500 ]; then
    PERCENT=25
else
    PERCENT=15  # only reachable with --force
fi

ZRAM_MB=$(( RAM_MB * PERCENT / 100 ))
info "Target: zram = ${PERCENT}% of RAM = ${ZRAM_MB} MB, zstd, swap priority 100"

# ── Choose backend ──────────────────────────────────────────────────────
BACKEND=""
if dpkg -s systemd-zram-generator &>/dev/null; then
    BACKEND="systemd"
elif dpkg -s zram-tools &>/dev/null; then
    BACKEND="zram-tools"
else
    info "No zram backend installed — installing systemd-zram-generator (modern)..."
    sudo apt update -qq
    sudo apt install -y systemd-zram-generator >/dev/null
    BACKEND="systemd"
    ok "systemd-zram-generator installed"
fi
info "Backend: $BACKEND"

# ── Configure ───────────────────────────────────────────────────────────
if [ "$BACKEND" = "systemd" ]; then
    CONF="/etc/systemd/zram-generator.conf"
    TMP=$(mktemp)
    cat > "$TMP" <<EOF
# Managed by birdash configure_zram.sh — re-run the script to update.
# Detected: $PI_MODEL with ${RAM_MB} MB RAM.

[zram0]
zram-size = ram * ${PERCENT} / 100
compression-algorithm = zstd
swap-priority = 100
EOF
    if [ -f "$CONF" ] && cmp -s "$TMP" "$CONF"; then
        ok "Config already up-to-date ($CONF)"
        rm -f "$TMP"
    else
        sudo cp "$TMP" "$CONF"
        rm -f "$TMP"
        ok "Wrote $CONF"
        # systemd-zram-generator picks up changes via daemon-reload + service restart
        sudo systemctl daemon-reload
        sudo systemctl stop systemd-zram-setup@zram0.service 2>/dev/null || true
        sudo swapoff /dev/zram0 2>/dev/null || true
        sudo systemctl start systemd-zram-setup@zram0.service 2>/dev/null || true
        ok "systemd-zram-setup@zram0 reloaded"
    fi
else
    # zram-tools legacy path
    CONF="/etc/default/zramswap"
    TMP=$(mktemp)
    cat > "$TMP" <<EOF
# Managed by birdash configure_zram.sh — re-run the script to update.
# Detected: $PI_MODEL with ${RAM_MB} MB RAM.

ALGO=zstd
PERCENT=${PERCENT}
PRIORITY=100
EOF
    if [ -f "$CONF" ] && cmp -s "$TMP" "$CONF"; then
        ok "Config already up-to-date ($CONF)"
        rm -f "$TMP"
    else
        sudo cp "$TMP" "$CONF"
        rm -f "$TMP"
        ok "Wrote $CONF"
    fi

    if systemctl list-unit-files zramswap.service &>/dev/null; then
        sudo systemctl enable zramswap.service >/dev/null 2>&1 || true
        sudo systemctl restart zramswap.service
        sleep 1
        if systemctl is-active --quiet zramswap.service; then
            ok "zramswap.service active"
        else
            warn "zramswap.service did not come up — check 'journalctl -u zramswap'"
        fi
    fi
fi

show_status

ok "Done."
echo ""
