#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Veha Server Installer
#
# One-liner:
#   curl -sSfL https://raw.githubusercontent.com/koompi/koompi-veha/main/scripts/install-server.sh | sudo bash
#
# Installs:  veha-api binary + React dashboard
# Creates:   /opt/veha/ (binary, database, media, static files)
# Sets up:   systemd service (veha-server.service)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="koompi/koompi-veha"
INSTALL_DIR="/opt/veha"
SERVICE_NAME="veha-server"

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

# ── Preflight ───────────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || fail "This script must be run as root (or with sudo)"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|aarch64) ;;
    *) fail "Unsupported architecture: $ARCH (need x86_64 or aarch64)" ;;
esac

info "Veha Server Installer"
info "Architecture: $ARCH"
echo ""

# ── Detect package manager ──────────────────────────────────────────────────

install_deps() {
    if command -v apt-get &>/dev/null; then
        info "Installing dependencies (apt)..."
        apt-get update -qq
        apt-get install -y -qq curl git build-essential pkg-config \
            libssl-dev libsqlite3-dev \
            libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev
    elif command -v pacman &>/dev/null; then
        info "Installing dependencies (pacman)..."
        pacman -Sy --noconfirm --needed curl git base-devel openssl sqlite ffmpeg
    elif command -v dnf &>/dev/null; then
        info "Installing dependencies (dnf)..."
        dnf install -y curl git gcc make openssl-devel sqlite-devel \
            ffmpeg-devel libavcodec-free-devel
    else
        warn "Unknown package manager. Please install: curl, git, build tools, FFmpeg dev libs, SQLite dev"
    fi
}

install_rust() {
    if command -v rustc &>/dev/null; then
        ok "Rust already installed ($(rustc --version))"
    else
        info "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        export PATH="$HOME/.cargo/bin:$PATH"
        # Also make it available for the user who'll run this
        if [ -n "${SUDO_USER:-}" ]; then
            su - "$SUDO_USER" -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable' 2>/dev/null || true
        fi
    fi
}

install_bun() {
    if command -v bun &>/dev/null; then
        ok "Bun already installed ($(bun --version))"
    else
        info "Installing Bun (for dashboard build)..."
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
    fi
}

# ── Install dependencies ───────────────────────────────────────────────────

install_deps
install_rust
install_bun

# Ensure cargo is in PATH
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"

# ── Clone and build ────────────────────────────────────────────────────────

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

info "Cloning repository..."
git clone --depth 1 "https://github.com/$REPO.git" "$BUILD_DIR/veha"

info "Building veha-api (this may take a few minutes)..."
cd "$BUILD_DIR/veha"
cargo build --release -p veha-api

info "Building dashboard..."
cd "$BUILD_DIR/veha/veha-dashboard"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run build

# ── Install ────────────────────────────────────────────────────────────────

info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"/{media,static}

cp "$BUILD_DIR/veha/target/release/veha-api" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/veha-api"

# Deploy dashboard
rm -rf "$INSTALL_DIR/static/"*
cp -r "$BUILD_DIR/veha/veha-dashboard/dist/"* "$INSTALL_DIR/static/"

ok "Binaries and dashboard installed to $INSTALL_DIR"

# ── Prompt for configuration ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}Server Configuration${NC}"
echo ""

# Bind address
read -rp "Bind address [0.0.0.0:3000]: " BIND_ADDR
BIND_ADDR=${BIND_ADDR:-0.0.0.0:3000}

# CORS origins (optional)
read -rp "CORS origins (comma-separated, blank for permissive): " CORS_ORIGINS

# API key for agents (optional)
read -rp "API key for agent auth (blank to disable): " API_KEY

# ── Create systemd service ─────────────────────────────────────────────────

info "Creating systemd service..."

EXEC_ARGS="--bind $BIND_ADDR --database $INSTALL_DIR/veha.db --media-dir $INSTALL_DIR/media"
[ -n "$CORS_ORIGINS" ] && EXEC_ARGS="$EXEC_ARGS --cors-origins $CORS_ORIGINS"

ENV_LINE=""
[ -n "$API_KEY" ] && ENV_LINE="Environment=VEHA_API_KEY=$API_KEY"

cat > /etc/systemd/system/${SERVICE_NAME}.service <<SERVICEEOF
[Unit]
Description=Veha API Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-api $EXEC_ARGS
WorkingDirectory=$INSTALL_DIR
Restart=always
RestartSec=5
$ENV_LINE

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}

ok "Service ${SERVICE_NAME} started"

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Veha Server installed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Dashboard:  ${BOLD}http://$BIND_ADDR${NC}"
echo -e "  Data dir:   $INSTALL_DIR"
echo -e "  Database:   $INSTALL_DIR/veha.db"
echo -e "  Media:      $INSTALL_DIR/media/"
echo ""
echo -e "  ${YELLOW}Default admin credentials are printed in the service log:${NC}"
echo -e "  ${CYAN}sudo journalctl -u ${SERVICE_NAME} | grep password${NC}"
echo ""
echo -e "  Manage service:"
echo -e "    sudo systemctl status ${SERVICE_NAME}"
echo -e "    sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo -e "  To install edge devices (billboards), run on each device:"
echo -e "  ${CYAN}curl -sSfL https://raw.githubusercontent.com/$REPO/main/scripts/install-edge.sh | sudo bash${NC}"
echo ""
