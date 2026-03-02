#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Veha Server Installer
#
# One-liner:
#   curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-server.sh | sudo bash
#
# Options:
#   --uninstall           Remove veha server completely
#   VEHA_VERSION=v1.0.0   Pin to a specific git tag/branch
#
# Installs:  veha-api binary + React dashboard
# Creates:   /opt/veha/ (binary, database, media, static files)
# Sets up:   systemd service (veha-server.service)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="rithythul/koompi-veha"
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

# prompt "message" VARNAME — reads from /dev/tty so curl|bash works
prompt() {
    local msg="$1" var="$2"
    read -rp "$msg" "$var" </dev/tty
}

# ── Uninstall ────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--uninstall" ]; then
    [ "$(id -u)" -eq 0 ] || fail "Uninstall must be run as root (or with sudo)"

    echo ""
    echo -e "${BOLD}Veha Server Uninstaller${NC}"
    echo ""
    echo "This will:"
    echo "  - Stop and disable the ${SERVICE_NAME} service"
    echo "  - Remove the systemd unit file"
    echo "  - Remove $INSTALL_DIR (binary, dashboard, media, database)"
    echo ""
    warn "The database and uploaded media will be permanently deleted!"
    echo ""
    prompt "Are you sure? [y/N]: " CONFIRM_UNINSTALL
    case "${CONFIRM_UNINSTALL:-N}" in
        [Yy]*)
            info "Stopping service..."
            systemctl stop ${SERVICE_NAME} 2>/dev/null || true
            systemctl disable ${SERVICE_NAME} 2>/dev/null || true
            rm -f /etc/systemd/system/${SERVICE_NAME}.service
            systemctl daemon-reload

            info "Removing files..."
            rm -rf "$INSTALL_DIR"

            echo ""
            ok "Veha Server uninstalled successfully."
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
    x86_64|aarch64) ;;
    *) fail "Unsupported architecture: $ARCH (need x86_64 or aarch64)" ;;
esac

# Verify this script was fetched over HTTPS (if piped from curl)
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" = "/dev/stdin" ]; then
    info "Running from pipe — ensure you fetched this script over HTTPS"
fi

info "Veha Server Installer"
info "Architecture: $ARCH"
[ -n "${VEHA_VERSION:-}" ] && info "Version: $VEHA_VERSION" || info "Version: latest (HEAD)"
echo ""

# ── Detect and remove existing installation ───────────────────────────────

EXISTING_INSTALL=false

if pgrep -x veha-api &>/dev/null; then
    EXISTING_INSTALL=true
    warn "Detected running veha-api process"
fi

if systemctl is-enabled ${SERVICE_NAME} &>/dev/null 2>&1; then
    EXISTING_INSTALL=true
    warn "Detected existing ${SERVICE_NAME} systemd service"
fi

if [ -f "$INSTALL_DIR/veha-api" ]; then
    EXISTING_INSTALL=true
    warn "Detected existing install at $INSTALL_DIR"
fi

if [ "$EXISTING_INSTALL" = "true" ]; then
    echo ""
    info "Removing previous veha server before upgrade..."

    # Stop service
    systemctl stop ${SERVICE_NAME} 2>/dev/null || true

    # Kill any remaining process
    pkill -x veha-api 2>/dev/null || true
    sleep 1
    pkill -9 -x veha-api 2>/dev/null || true

    # Disable and remove service
    systemctl disable ${SERVICE_NAME} 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload

    # Remove old binary and dashboard (keep database, media, configs)
    rm -f "$INSTALL_DIR/veha-api"
    rm -rf "$INSTALL_DIR/static"

    ok "Previous installation removed (database and media preserved)"
    echo ""
fi

# ── Detect package manager ──────────────────────────────────────────────────

install_deps() {
    if command -v apt-get &>/dev/null; then
        info "Installing dependencies (apt)..."
        apt-get update -qq
        apt-get install -y -qq curl git build-essential pkg-config \
            libssl-dev libsqlite3-dev clang libclang-dev \
            libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev
    elif command -v pacman &>/dev/null; then
        info "Installing dependencies (pacman)..."
        pacman -S --noconfirm --needed curl git base-devel openssl sqlite ffmpeg clang
    elif command -v dnf &>/dev/null; then
        info "Installing dependencies (dnf)..."
        dnf install -y curl git gcc make openssl-devel sqlite-devel clang clang-devel \
            ffmpeg-devel libavcodec-free-devel
    else
        warn "Unknown package manager. Please install: curl, git, build tools, FFmpeg dev libs, SQLite dev"
    fi
}

install_rust() {
    # Prefer building as SUDO_USER to avoid filling /root with toolchains
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

install_bun() {
    if su - "$BUILD_USER" -c 'command -v bun' &>/dev/null; then
        ok "Bun already installed for $BUILD_USER"
        BUN_PREEXISTING=true
    elif command -v bun &>/dev/null; then
        ok "Bun already installed ($(bun --version))"
        BUN_PREEXISTING=true
    else
        info "Installing Bun for $BUILD_USER (for dashboard build)..."
        if [ "$BUILD_USER" = "root" ]; then
            curl -fsSL https://bun.sh/install | bash
        else
            su - "$BUILD_USER" -c 'curl -fsSL https://bun.sh/install | bash'
        fi
        BUN_PREEXISTING=false
    fi
    BUN_BIN="$BUILD_HOME/.bun/bin"
}

# ── Install dependencies ───────────────────────────────────────────────────

install_deps
install_rust
install_bun

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

# ── Clone and build ────────────────────────────────────────────────────────

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

info "Cloning repository..."
git clone --depth 1 ${VEHA_VERSION:+--branch "$VEHA_VERSION"} "https://github.com/$REPO.git" "$BUILD_DIR/veha"

# Build as BUILD_USER
chown -R "$BUILD_USER:$BUILD_GROUP" "$BUILD_DIR"

run_as_build_user() {
    if [ "$BUILD_USER" = "root" ]; then
        env PATH="$CARGO_BIN:$BUN_BIN:$PATH" ${LIBCLANG_ENV:+$LIBCLANG_ENV} "$@"
    else
        su - "$BUILD_USER" -c "cd '$BUILD_DIR/veha' && export PATH=\"$CARGO_BIN:$BUN_BIN:/usr/local/bin:/usr/bin:/bin:\$PATH\" ${LIBCLANG_ENV:+&& export $LIBCLANG_ENV} && $*"
    fi
}

info "Building veha-api (this may take a few minutes)..."
run_as_build_user cargo build --release -p veha-api

info "Building dashboard..."
run_as_build_user "cd veha-dashboard && (bun install --frozen-lockfile || bun install) && bun run build"

# ── Install ────────────────────────────────────────────────────────────────

info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"/{media,static}

cp "$BUILD_DIR/veha/target/release/veha-api" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/veha-api"

# Deploy dashboard
rm -rf "$INSTALL_DIR/static"
mkdir -p "$INSTALL_DIR/static"
cp -r "$BUILD_DIR/veha/veha-dashboard/dist/"* "$INSTALL_DIR/static/"

ok "Binaries and dashboard installed to $INSTALL_DIR"

# ── Prompt for configuration ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}Server Configuration${NC}"
echo ""

# Bind address
prompt "Bind address [0.0.0.0:3000]: " BIND_ADDR
BIND_ADDR=${BIND_ADDR:-0.0.0.0:3000}

# CORS origins (optional)
prompt "CORS origins (comma-separated, blank for permissive): " CORS_ORIGINS

# API key for agents (optional)
prompt "API key for agent auth (blank to disable): " API_KEY

# ── Create systemd service ─────────────────────────────────────────────────

info "Creating systemd service..."

EXEC_ARGS="--bind $BIND_ADDR --database $INSTALL_DIR/veha.db --media-dir $INSTALL_DIR/media"
[ -n "$CORS_ORIGINS" ] && EXEC_ARGS="$EXEC_ARGS --cors-origins '$CORS_ORIGINS'"

# Write environment file with restrictive permissions
ENV_FILE="$INSTALL_DIR/.env"
cat > "$ENV_FILE" <<ENVEOF
# Veha API server environment — auto-generated by installer
VEHA_API_KEY=$API_KEY
ENVEOF
chmod 600 "$ENV_FILE"
ok "Environment file written to $ENV_FILE (mode 600)"

cat > /etc/systemd/system/${SERVICE_NAME}.service <<SERVICEEOF
[Unit]
Description=Veha API Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/veha-api $EXEC_ARGS
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
Restart=always
RestartSec=5

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
echo -e "  Uninstall:"
echo -e "    curl -sSfL https://raw.githubusercontent.com/$REPO/main/scripts/install-server.sh | sudo bash -s -- --uninstall"
echo ""

# Offer to clean up build toolchains if we installed them
CLEANUP_NEEDED=false
[ "${RUST_PREEXISTING:-true}" = "false" ] && CLEANUP_NEEDED=true
[ "${BUN_PREEXISTING:-true}" = "false" ] && CLEANUP_NEEDED=true

if [ "$CLEANUP_NEEDED" = "true" ]; then
    echo -e "${YELLOW}Build toolchains were installed for compilation:${NC}"
    [ "${RUST_PREEXISTING:-true}" = "false" ] && echo "  - Rust (~500MB) at $BUILD_HOME/.cargo"
    [ "${BUN_PREEXISTING:-true}" = "false" ] && echo "  - Bun (~50MB) at $BUILD_HOME/.bun"
    echo ""
    prompt "Remove build toolchains? (not needed at runtime) [Y/n]: " CLEANUP_TOOLS
    CLEANUP_TOOLS=${CLEANUP_TOOLS:-Y}
    case "$CLEANUP_TOOLS" in
        [Yy]*)
            if [ "${RUST_PREEXISTING:-true}" = "false" ]; then
                if [ "$BUILD_USER" = "root" ]; then
                    rm -rf "$BUILD_HOME/.cargo" "$BUILD_HOME/.rustup"
                else
                    su - "$BUILD_USER" -c 'rm -rf "$HOME/.cargo" "$HOME/.rustup"'
                fi
                ok "Rust toolchain removed"
            fi
            if [ "${BUN_PREEXISTING:-true}" = "false" ]; then
                if [ "$BUILD_USER" = "root" ]; then
                    rm -rf "$BUILD_HOME/.bun"
                else
                    su - "$BUILD_USER" -c 'rm -rf "$HOME/.bun"'
                fi
                ok "Bun removed"
            fi
            ;;
        *) info "Build toolchains kept" ;;
    esac
fi
