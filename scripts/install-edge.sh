#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Veha Edge Device Installer (Billboard)
#
# Interactive:
#   curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | sudo bash
#
# Non-interactive (e.g. via SSH):
#   curl -sSfL ... | sudo SERVER_URL=http://192.168.1.100:3000 BOARD_ID=board-001 bash
#
# Options:
#   --uninstall           Remove veha edge device completely
#   VEHA_VERSION=v1.0.0   Pin to a specific git tag/branch
#
# Environment variables (skip prompts when set):
#   SERVER_URL    API server URL (required)
#   BOARD_ID      Unique board identifier (required)
#   BOARD_NAME    Display name (default: BOARD_ID)
#   WIDTH         Display width (default: 1920)
#   HEIGHT        Display height (default: 1080)
#   OUTPUT_BACKEND  framebuffer|window|null (default: auto-detect)
#   API_KEY       API key for agent auth (default: none)
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

# Detect interactive mode — test if /dev/tty is actually readable
INTERACTIVE=false
if (echo -n '' > /dev/tty) 2>/dev/null; then
    INTERACTIVE=true
fi

# prompt "message" VARNAME — reads from /dev/tty in interactive mode, skips in non-interactive
prompt() {
    local msg="$1" var="$2"
    if [ "$INTERACTIVE" = "true" ]; then
        read -rp "$msg" "$var" </dev/tty
    fi
    # In non-interactive mode, the variable keeps its current (env) value
}

# ── Uninstall ────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    [ "$(id -u)" -eq 0 ] || fail "Uninstall must be run as root (or with sudo)"

    echo ""
    echo -e "${BOLD}Veha Edge Device Uninstaller${NC}"
    echo ""
    echo "This will:"
    echo "  - Stop and disable veha-player and veha-agent services"
    echo "  - Remove systemd unit files"
    echo "  - Remove $INSTALL_DIR (binaries, configs)"
    echo "  - Remove /run/veha and /var/cache/veha"
    echo ""
    prompt "Are you sure? [y/N]: " CONFIRM_UNINSTALL
    case "${CONFIRM_UNINSTALL:-N}" in
        [Yy]*)
            info "Stopping services..."
            systemctl stop veha-player veha-agent 2>/dev/null || true
            systemctl disable veha-player veha-agent 2>/dev/null || true
            rm -f /etc/systemd/system/veha-player.service /etc/systemd/system/veha-agent.service
            systemctl daemon-reload

            info "Removing files..."
            rm -rf "$INSTALL_DIR"
            rm -rf /run/veha /var/cache/veha

            echo ""
            ok "Veha Edge Device uninstalled successfully."
            ;;
        *)
            echo "Aborted."
            ;;
    esac
    exit 0
fi

# ── Preflight ───────────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || fail "This script must be run as root (or with sudo)"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|aarch64|armv7l) ;;
    *) fail "Unsupported architecture: $ARCH" ;;
esac

echo ""
# Verify this script was fetched over HTTPS (if piped from curl)
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" = "/dev/stdin" ]; then
    info "Running from pipe — ensure you fetched this script over HTTPS"
fi

echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Veha Billboard Edge Installer        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
info "Architecture: $ARCH"
[ -n "${VEHA_VERSION:-}" ] && info "Version: $VEHA_VERSION" || info "Version: latest (HEAD)"
echo ""

# ── Detect and remove existing installation ───────────────────────────────

EXISTING_INSTALL=false

# Check for running processes
if pgrep -x veha-player &>/dev/null || pgrep -x veha-agent &>/dev/null; then
    EXISTING_INSTALL=true
    warn "Detected running veha processes"
fi

# Check for systemd services
if systemctl list-unit-files veha-player.service &>/dev/null 2>&1 || \
   systemctl list-unit-files veha-agent.service &>/dev/null 2>&1; then
    if systemctl is-enabled veha-player &>/dev/null 2>&1 || \
       systemctl is-enabled veha-agent &>/dev/null 2>&1; then
        EXISTING_INSTALL=true
        warn "Detected existing veha systemd services"
    fi
fi

# Check for install directory
if [ -d "$INSTALL_DIR" ]; then
    EXISTING_INSTALL=true
    warn "Detected existing install at $INSTALL_DIR"
fi

if [ "$EXISTING_INSTALL" = "true" ]; then
    echo ""
    info "Removing previous veha installation before upgrade..."

    # Stop services
    systemctl stop veha-player veha-agent 2>/dev/null || true

    # Kill any remaining processes
    pkill -x veha-player 2>/dev/null || true
    pkill -x veha-agent 2>/dev/null || true
    sleep 1
    # Force kill if still running
    pkill -9 -x veha-player 2>/dev/null || true
    pkill -9 -x veha-agent 2>/dev/null || true

    # Disable and remove services
    systemctl disable veha-player veha-agent 2>/dev/null || true
    rm -f /etc/systemd/system/veha-player.service /etc/systemd/system/veha-agent.service
    systemctl daemon-reload

    # Remove old binaries (keep configs if present — they'll be overwritten later)
    rm -f "$INSTALL_DIR/veha-player" "$INSTALL_DIR/veha-agent"

    # Clean up runtime files
    rm -f /run/veha/player.sock
    rm -rf /run/veha

    ok "Previous installation removed"
    echo ""
fi

# ── Collect configuration ──────────────────────────────────────────────────

# Pre-set from env vars (allows non-interactive use)
SERVER_URL="${SERVER_URL:-}"
BOARD_ID="${BOARD_ID:-}"
BOARD_NAME="${BOARD_NAME:-}"
WIDTH="${WIDTH:-}"
HEIGHT="${HEIGHT:-}"
OUTPUT_BACKEND="${OUTPUT_BACKEND:-}"
API_KEY="${API_KEY:-}"

if [ "$INTERACTIVE" = "true" ]; then
    echo -e "${BOLD}Billboard Configuration${NC}"
    echo ""

    # Server URL (required)
    while [ -z "$SERVER_URL" ]; do
        prompt "API server URL (e.g. http://192.168.1.100:3000): " SERVER_URL
        SERVER_URL=${SERVER_URL%/}
        [ -n "$SERVER_URL" ] || echo -e "${RED}  Server URL is required${NC}"
    done

    # Board ID (required)
    while [ -z "$BOARD_ID" ]; do
        prompt "Board ID (unique, e.g. board-pp-riverside-001): " BOARD_ID
        [ -n "$BOARD_ID" ] || echo -e "${RED}  Board ID is required${NC}"
    done

    # Board name
    prompt "Board name [${BOARD_ID}]: " BOARD_NAME
    BOARD_NAME=${BOARD_NAME:-$BOARD_ID}

    # Resolution (only prompt if WIDTH/HEIGHT not already set via env)
    if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ]; then
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
                [[ "$WIDTH" =~ ^[0-9]+$ ]] || fail "Width must be a positive number"
                [[ "$HEIGHT" =~ ^[0-9]+$ ]] || fail "Height must be a positive number"
                [ "$WIDTH" -gt 0 ] || fail "Width must be greater than 0"
                [ "$HEIGHT" -gt 0 ] || fail "Height must be greater than 0"
                ;;
            *) WIDTH=1920; HEIGHT=1080 ;;
        esac
    fi

    # Output backend (only prompt if not set via env)
    if [ -z "$OUTPUT_BACKEND" ]; then
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
    fi

    # API key (optional, only prompt if not set via env)
    if [ -z "$API_KEY" ]; then
        prompt "API key (blank if none): " API_KEY
        API_KEY=${API_KEY:-}
    fi
else
    # Non-interactive — validate required vars
    [ -n "$SERVER_URL" ] || fail "SERVER_URL is required (set via environment variable)"
    [ -n "$BOARD_ID" ] || fail "BOARD_ID is required (set via environment variable)"
    info "Non-interactive mode — using environment variables"
fi

# Apply defaults for anything still unset
SERVER_URL=${SERVER_URL%/}
BOARD_NAME=${BOARD_NAME:-$BOARD_ID}
WIDTH=${WIDTH:-1920}
HEIGHT=${HEIGHT:-1080}
OUTPUT_BACKEND=${OUTPUT_BACKEND:-window}
API_KEY=${API_KEY:-}

# Derive WebSocket URL from HTTP URL
WS_URL=$(echo "$SERVER_URL" | sed 's|^http://|ws://|; s|^https://|wss://|')
WS_URL="${WS_URL}/ws/agent"

# Warn about non-TLS URLs
case "$SERVER_URL" in
    http://*) warn "Using unencrypted HTTP. Consider HTTPS for production." ;;
esac

# Detect desktop user + display vars when window backend is selected
DESKTOP_USER="root"
DESKTOP_ENV_LINES=""
SERVICE_AFTER="network.target"
SERVICE_TARGET="multi-user.target"

if [ "$OUTPUT_BACKEND" = "window" ]; then
    # Find the logged-in desktop user (the one who invoked sudo)
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
        DESKTOP_USER="$SUDO_USER"
    else
        # Fallback: find who owns the display session
        DESKTOP_USER=$(who | grep -E 'tty|:0|seat' | head -1 | awk '{print $1}')
        DESKTOP_USER=${DESKTOP_USER:-root}
    fi

    DESKTOP_UID=$(id -u "$DESKTOP_USER" 2>/dev/null || echo 1000)
    DESKTOP_GROUP=$(id -gn "$DESKTOP_USER" 2>/dev/null || echo "$DESKTOP_USER")
    DESKTOP_HOME=$(getent passwd "$DESKTOP_USER" | cut -d: -f6)
    DESKTOP_HOME=${DESKTOP_HOME:-/home/$DESKTOP_USER}
    XDG_DIR="/run/user/$DESKTOP_UID"

    # Detect display server
    if [ -n "${WAYLAND_DISPLAY:-}" ]; then
        DESKTOP_ENV_LINES="Environment=WAYLAND_DISPLAY=${WAYLAND_DISPLAY}
Environment=XDG_RUNTIME_DIR=${XDG_DIR}"
    elif [ -n "${DISPLAY:-}" ]; then
        DESKTOP_ENV_LINES="Environment=DISPLAY=${DISPLAY}
Environment=XAUTHORITY=${DESKTOP_HOME}/.Xauthority"
    else
        # Try to detect from the user's session
        if [ -S "${XDG_DIR}/wayland-0" ] || [ -S "${XDG_DIR}/wayland-1" ]; then
            WL_SOCK=""
            for f in "${XDG_DIR}"/wayland-*; do
                WL_SOCK=$(basename "$f")
                break
            done
            DESKTOP_ENV_LINES="Environment=WAYLAND_DISPLAY=${WL_SOCK}
Environment=XDG_RUNTIME_DIR=${XDG_DIR}"
        else
            DESKTOP_ENV_LINES="Environment=DISPLAY=:0
Environment=XAUTHORITY=${DESKTOP_HOME}/.Xauthority"
        fi
    fi

    SERVICE_AFTER="network.target graphical.target"
    SERVICE_TARGET="graphical.target"
    info "Window backend: services will run as $DESKTOP_USER"
fi

echo ""
info "Configuration summary:"
echo "  Server:   $SERVER_URL"
echo "  WS URL:   $WS_URL"
echo "  Board ID: $BOARD_ID"
echo "  Name:     $BOARD_NAME"
echo "  Display:  ${WIDTH}x${HEIGHT} ($OUTPUT_BACKEND)"
if [ "$OUTPUT_BACKEND" = "window" ]; then
    echo "  Run as:   $DESKTOP_USER (desktop session)"
fi
echo ""
if [ "$INTERACTIVE" = "true" ]; then
    prompt "Continue? [Y/n]: " CONFIRM
    CONFIRM=${CONFIRM:-Y}
    case "$CONFIRM" in
        [Yy]*) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

# ── Install dependencies ───────────────────────────────────────────────────

install_deps() {
    if command -v apt-get &>/dev/null; then
        info "Installing dependencies (apt)..."
        apt-get update -qq
        apt-get install -y -qq curl git build-essential pkg-config \
            libssl-dev clang libclang-dev \
            ffmpeg libavcodec-dev libavformat-dev libavutil-dev \
            libswscale-dev libswresample-dev
    elif command -v pacman &>/dev/null; then
        info "Installing dependencies (pacman)..."
        pacman -S --noconfirm --needed curl git base-devel openssl ffmpeg clang
    elif command -v dnf &>/dev/null; then
        info "Installing dependencies (dnf)..."
        dnf install -y curl git gcc make openssl-devel clang clang-devel \
            ffmpeg ffmpeg-devel
    else
        warn "Unknown package manager — please install: curl, git, build tools, FFmpeg 8+ dev libs"
    fi
}

install_rust() {
    # Determine build user — prefer SUDO_USER to avoid installing as root
    BUILD_USER="${SUDO_USER:-root}"
    BUILD_HOME=$(getent passwd "$BUILD_USER" | cut -d: -f6)
    BUILD_HOME=${BUILD_HOME:-$HOME}

    if su - "$BUILD_USER" -c 'command -v cargo' &>/dev/null; then
        ok "Rust already installed for $BUILD_USER ($(su - "$BUILD_USER" -c 'rustc --version'))"
        RUST_PREEXISTING=true
    elif command -v cargo &>/dev/null; then
        ok "Rust already installed ($(rustc --version))"
        BUILD_USER="root"
        BUILD_HOME="$HOME"
        RUST_PREEXISTING=true
    else
        info "Installing Rust for $BUILD_USER..."
        if [ "$BUILD_USER" = "root" ]; then
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        else
            su - "$BUILD_USER" -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable'
        fi
        RUST_PREEXISTING=false
    fi
    CARGO_BIN="$BUILD_HOME/.cargo/bin"
    BUILD_GROUP=$(id -gn "$BUILD_USER" 2>/dev/null || echo "$BUILD_USER")
}

install_deps
install_rust

# Detect libclang path
LIBCLANG_ENV=""
if [ -z "${LIBCLANG_PATH:-}" ]; then
    for dir in /usr/lib /usr/lib64 /usr/lib/llvm-*/lib; do
        if ls "$dir"/libclang.so* &>/dev/null 2>&1; then
            LIBCLANG_ENV="LIBCLANG_PATH=$dir"
            info "LIBCLANG_PATH=$dir"
            break
        fi
    done
else
    LIBCLANG_ENV="LIBCLANG_PATH=$LIBCLANG_PATH"
fi

# Verify FFmpeg
if ! pkg-config --exists libavcodec 2>/dev/null; then
    warn "FFmpeg dev libraries not detected by pkg-config."
    warn "The build may fail. Install libavcodec-dev and related packages."
fi

# ── Clone and build ────────────────────────────────────────────────────────

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

info "Cloning repository..."
git clone --depth 1 ${VEHA_VERSION:+--branch "$VEHA_VERSION"} "https://github.com/$REPO.git" "$BUILD_DIR/veha"

# Build as BUILD_USER
chown -R "$BUILD_USER:$BUILD_GROUP" "$BUILD_DIR"

FEATURES_FLAG=""
if [ "$OUTPUT_BACKEND" = "framebuffer" ]; then
    FEATURES_FLAG="--features framebuffer"
fi

run_as_build_user() {
    if [ "$BUILD_USER" = "root" ]; then
        env PATH="$CARGO_BIN:$PATH" ${LIBCLANG_ENV:+$LIBCLANG_ENV} "$@"
    else
        su - "$BUILD_USER" -c "cd '$BUILD_DIR/veha' && export PATH='$CARGO_BIN:\$PATH' ${LIBCLANG_ENV:+&& export $LIBCLANG_ENV} && $*"
    fi
}

info "Building veha-player (this may take a few minutes)..."
run_as_build_user cargo build --release -p veha-player $FEATURES_FLAG

info "Building veha-agent..."
run_as_build_user cargo build --release -p veha-agent

# ── Install binaries ───────────────────────────────────────────────────────

info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

cp "$BUILD_DIR/veha/target/release/veha-player" "$INSTALL_DIR/"
cp "$BUILD_DIR/veha/target/release/veha-agent" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/veha-player" "$INSTALL_DIR/veha-agent"

ok "Binaries installed"

# ── Generate config files ──────────────────────────────────────────────────

info "Writing configuration files..."

# Back up existing configs if re-installing
for cfg in veha-player.toml veha-agent.toml; do
    if [ -f "$INSTALL_DIR/$cfg" ]; then
        cp "$INSTALL_DIR/$cfg" "$INSTALL_DIR/$cfg.bak"
        warn "Backed up existing $cfg to $cfg.bak"
    fi
done

# Create runtime and cache directories
mkdir -p /run/veha
mkdir -p /var/cache/veha
chown "$DESKTOP_USER:${DESKTOP_GROUP:-$DESKTOP_USER}" /run/veha /var/cache/veha

# Player config
cat > "$INSTALL_DIR/veha-player.toml" <<PLAYEREOF
output_backend = "$OUTPUT_BACKEND"
width = $WIDTH
height = $HEIGHT
fullscreen = true
socket_path = "/run/veha/player.sock"
title = "veha-player"
PLAYEREOF

# Agent config
cat > "$INSTALL_DIR/veha-agent.toml" <<AGENTEOF
board_id = "$BOARD_ID"
board_name = "$BOARD_NAME"
api_url = "$WS_URL"
api_key = "$API_KEY"
player_socket = "/run/veha/player.sock"
report_interval_secs = 10
cache_dir = "/var/cache/veha"
AGENTEOF

chmod 600 "$INSTALL_DIR/veha-agent.toml"

ok "Config files written"

# ── Create systemd services ───────────────────────────────────────────────

info "Creating systemd services..."

cat > /etc/systemd/system/veha-player.service <<SVCEOF
[Unit]
Description=Veha Billboard Player
After=$SERVICE_AFTER

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-player -c $INSTALL_DIR/veha-player.toml
WorkingDirectory=$INSTALL_DIR
RuntimeDirectory=veha
RuntimeDirectoryMode=0750
Restart=always
RestartSec=5
User=$DESKTOP_USER
${DESKTOP_ENV_LINES:+$DESKTOP_ENV_LINES}
ExecStopPost=/bin/rm -f /run/veha/player.sock

[Install]
WantedBy=$SERVICE_TARGET
SVCEOF

cat > /etc/systemd/system/veha-agent.service <<SVCEOF
[Unit]
Description=Veha Billboard Agent
After=network-online.target veha-player.service
Wants=network-online.target veha-player.service

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-agent -c $INSTALL_DIR/veha-agent.toml
WorkingDirectory=$INSTALL_DIR
CacheDirectory=veha
CacheDirectoryMode=0750
Restart=always
RestartSec=5
User=$DESKTOP_USER

[Install]
WantedBy=$SERVICE_TARGET
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
echo -e "  Uninstall:"
echo -e "    curl -sSfL https://raw.githubusercontent.com/$REPO/main/scripts/install-edge.sh | sudo bash -s -- --uninstall"
echo ""

# Offer to clean up Rust toolchain if we installed it
if [ "$RUST_PREEXISTING" = "false" ]; then
    if [ "$INTERACTIVE" = "true" ]; then
        echo -e "${YELLOW}The Rust toolchain (~500MB) was installed for the build.${NC}"
        prompt "Remove Rust toolchain? (not needed at runtime) [Y/n]: " CLEANUP_RUST
    fi
    CLEANUP_RUST=${CLEANUP_RUST:-Y}
    case "$CLEANUP_RUST" in
        [Yy]*)
            if [ "$BUILD_USER" = "root" ]; then
                rm -rf "$BUILD_HOME/.cargo" "$BUILD_HOME/.rustup"
            else
                su - "$BUILD_USER" -c 'rm -rf "$HOME/.cargo" "$HOME/.rustup"'
            fi
            ok "Rust toolchain removed"
            ;;
        *) info "Rust toolchain kept at $BUILD_HOME/.cargo" ;;
    esac
fi
