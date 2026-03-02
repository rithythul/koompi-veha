#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Veha Edge Device Installer (Billboard)
#
# One-liner:
#   curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | sudo bash
#
# Installs:  veha-agent + veha-player (with framebuffer support)
# Creates:   /opt/veha/ (binaries, TOML configs)
# Sets up:   systemd services (veha-player.service, veha-agent.service)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="rithythul/koompi-veha"
INSTALL_DIR="/opt/veha"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# prompt "message" VARNAME — reads from /dev/tty so curl|bash works
prompt() {
    local msg="$1" var="$2"
    read -rp "$msg" "$var" </dev/tty
}

# ── Preflight ───────────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || fail "This script must be run as root (or with sudo)"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|aarch64|armv7l) ;;
    *) fail "Unsupported architecture: $ARCH" ;;
esac

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Veha Billboard Edge Installer        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
info "Architecture: $ARCH"
echo ""

# ── Collect configuration ──────────────────────────────────────────────────

echo -e "${BOLD}Billboard Configuration${NC}"
echo ""

# Server URL (required)
while true; do
    prompt "API server URL (e.g. http://192.168.1.100:3000): " SERVER_URL
    SERVER_URL=${SERVER_URL%/}  # strip trailing slash
    if [ -n "$SERVER_URL" ]; then
        break
    fi
    echo -e "${RED}  Server URL is required${NC}"
done

# Derive WebSocket URL from HTTP URL
WS_URL=$(echo "$SERVER_URL" | sed 's|^http://|ws://|; s|^https://|wss://|')
WS_URL="${WS_URL}/ws/agent"

# Board ID (required)
while true; do
    prompt "Board ID (unique, e.g. board-pp-riverside-001): " BOARD_ID
    if [ -n "$BOARD_ID" ]; then
        break
    fi
    echo -e "${RED}  Board ID is required${NC}"
done

# Board name
prompt "Board name [${BOARD_ID}]: " BOARD_NAME
BOARD_NAME=${BOARD_NAME:-$BOARD_ID}

# Resolution
echo ""
echo "  Common resolutions:"
echo "    1) 1920x1080 (Full HD landscape)"
echo "    2) 1080x1920 (Full HD portrait)"
echo "    3) 3840x2160 (4K UHD)"
echo "    4) Custom"
echo ""
prompt "Select resolution [1]: " RES_CHOICE
RES_CHOICE=${RES_CHOICE:-1}

case "$RES_CHOICE" in
    1) WIDTH=1920; HEIGHT=1080 ;;
    2) WIDTH=1080; HEIGHT=1920 ;;
    3) WIDTH=3840; HEIGHT=2160 ;;
    4)
        prompt "  Width: " WIDTH
        prompt "  Height: " HEIGHT
        ;;
    *) WIDTH=1920; HEIGHT=1080 ;;
esac

# Output backend — auto-detect desktop environment
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${XDG_CURRENT_DESKTOP:-}" ]; then
    DEFAULT_BACKEND=2
    DETECT_MSG=" (desktop detected)"
else
    DEFAULT_BACKEND=1
    DETECT_MSG=" (no desktop detected)"
fi

echo ""
echo "  Output backend${DETECT_MSG}:"
echo "    1) framebuffer (headless — direct HDMI, no desktop needed)"
echo "    2) window (desktop — X11/Wayland, can run fullscreen)"
echo "    3) null (testing only, no display output)"
echo ""
prompt "Select output [${DEFAULT_BACKEND}]: " BACKEND_CHOICE
BACKEND_CHOICE=${BACKEND_CHOICE:-$DEFAULT_BACKEND}

case "$BACKEND_CHOICE" in
    1) OUTPUT_BACKEND="framebuffer" ;;
    2) OUTPUT_BACKEND="window" ;;
    3) OUTPUT_BACKEND="null" ;;
    *) OUTPUT_BACKEND="window" ;;
esac

# API key (optional)
prompt "API key (blank if none): " API_KEY
API_KEY=${API_KEY:-}

echo ""
info "Configuration summary:"
echo "  Server:   $SERVER_URL"
echo "  WS URL:   $WS_URL"
echo "  Board ID: $BOARD_ID"
echo "  Name:     $BOARD_NAME"
echo "  Display:  ${WIDTH}x${HEIGHT} ($OUTPUT_BACKEND)"
echo ""
prompt "Continue? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}
case "$CONFIRM" in
    [Yy]*) ;;
    *) echo "Aborted."; exit 0 ;;
esac

# ── Install dependencies ───────────────────────────────────────────────────

install_deps() {
    if command -v apt-get &>/dev/null; then
        info "Installing dependencies (apt)..."
        apt-get update -qq
        apt-get install -y -qq curl git build-essential pkg-config \
            libssl-dev \
            ffmpeg libavcodec-dev libavformat-dev libavutil-dev \
            libswscale-dev libswresample-dev
    elif command -v pacman &>/dev/null; then
        info "Installing dependencies (pacman)..."
        pacman -Sy --noconfirm --needed curl git base-devel openssl ffmpeg
    elif command -v dnf &>/dev/null; then
        info "Installing dependencies (dnf)..."
        dnf install -y curl git gcc make openssl-devel \
            ffmpeg ffmpeg-devel
    else
        warn "Unknown package manager — please install: curl, git, build tools, FFmpeg 8+ dev libs"
    fi
}

install_rust() {
    if command -v cargo &>/dev/null; then
        ok "Rust already installed ($(rustc --version))"
    else
        info "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
}

install_deps
install_rust
export PATH="$HOME/.cargo/bin:$PATH"

# Verify FFmpeg
if ! pkg-config --exists libavcodec 2>/dev/null; then
    warn "FFmpeg dev libraries not detected by pkg-config."
    warn "The build may fail. Install libavcodec-dev and related packages."
fi

# ── Clone and build ────────────────────────────────────────────────────────

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

info "Cloning repository..."
git clone --depth 1 "https://github.com/$REPO.git" "$BUILD_DIR/veha"
cd "$BUILD_DIR/veha"

FEATURES_FLAG=""
if [ "$OUTPUT_BACKEND" = "framebuffer" ]; then
    FEATURES_FLAG="--features framebuffer"
fi

info "Building veha-player (this may take a few minutes)..."
cargo build --release -p veha-player $FEATURES_FLAG

info "Building veha-agent..."
cargo build --release -p veha-agent

# ── Install binaries ───────────────────────────────────────────────────────

info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

cp "$BUILD_DIR/veha/target/release/veha-player" "$INSTALL_DIR/"
cp "$BUILD_DIR/veha/target/release/veha-agent" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/veha-player" "$INSTALL_DIR/veha-agent"

ok "Binaries installed"

# ── Generate config files ──────────────────────────────────────────────────

info "Writing configuration files..."

# Player config
cat > "$INSTALL_DIR/veha-player.toml" <<PLAYEREOF
output_backend = "$OUTPUT_BACKEND"
width = $WIDTH
height = $HEIGHT
socket_path = "/tmp/veha-player.sock"
title = "veha-player"
PLAYEREOF

# Agent config
cat > "$INSTALL_DIR/veha-agent.toml" <<AGENTEOF
board_id = "$BOARD_ID"
board_name = "$BOARD_NAME"
api_url = "$WS_URL"
api_key = "$API_KEY"
player_socket = "/tmp/veha-player.sock"
report_interval_secs = 10
cache_dir = "/tmp/veha-cache"
AGENTEOF

ok "Config files written"

# ── Create systemd services ───────────────────────────────────────────────

info "Creating systemd services..."

cat > /etc/systemd/system/veha-player.service <<SVCEOF
[Unit]
Description=Veha Billboard Player
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-player -c $INSTALL_DIR/veha-player.toml
WorkingDirectory=$INSTALL_DIR
Restart=always
RestartSec=5
User=root
ExecStopPost=/bin/rm -f /tmp/veha-player.sock

[Install]
WantedBy=multi-user.target
SVCEOF

cat > /etc/systemd/system/veha-agent.service <<SVCEOF
[Unit]
Description=Veha Billboard Agent
After=network-online.target veha-player.service
Wants=network-online.target
Requires=veha-player.service

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-agent -c $INSTALL_DIR/veha-agent.toml
WorkingDirectory=$INSTALL_DIR
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable veha-player veha-agent
systemctl start veha-player veha-agent

ok "Services started"

# ── Verify ─────────────────────────────────────────────────────────────────

echo ""

# Quick connectivity check
if command -v curl &>/dev/null; then
    if curl -sf "${SERVER_URL}/health" >/dev/null 2>&1; then
        ok "Server reachable at $SERVER_URL"
    else
        warn "Could not reach $SERVER_URL/health — check the server URL and firewall"
    fi
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Veha Edge Device installed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Board ID:     ${BOLD}$BOARD_ID${NC}"
echo -e "  Board Name:   $BOARD_NAME"
echo -e "  Display:      ${WIDTH}x${HEIGHT} ($OUTPUT_BACKEND)"
echo -e "  Server:       $SERVER_URL"
echo -e "  Install dir:  $INSTALL_DIR"
echo ""
echo -e "  The board will auto-register in the dashboard."
echo -e "  Open ${CYAN}$SERVER_URL${NC} and check ${BOLD}Boards${NC} to verify."
echo ""
echo -e "  Manage services:"
echo -e "    sudo systemctl status veha-player veha-agent"
echo -e "    sudo journalctl -u veha-agent -f"
echo -e "    sudo journalctl -u veha-player -f"
echo ""
echo -e "  Edit config:"
echo -e "    sudo nano $INSTALL_DIR/veha-agent.toml"
echo -e "    sudo nano $INSTALL_DIR/veha-player.toml"
echo -e "    sudo systemctl restart veha-player veha-agent"
echo ""
