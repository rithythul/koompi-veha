# koompi-veha-edge-os Design

> Minimal Arch Linux-based OS for billboard edge devices.

## Goal

Create a bootable ISO image (x86_64 + aarch64) that turns any PC or ARM board into a dedicated billboard display — no desktop environment, no manual setup beyond a one-time first-boot wizard.

## Architecture

```
Boot Flow:
  BIOS/UEFI → systemd-boot → kernel → systemd
    → veha-setup.service   (first boot only: text wizard → writes TOML configs → disables itself)
    → veha-player.service  (DRM/KMS output, renders media to display)
    → veha-agent.service   (WebSocket connection to central API server)
```

No X11, no Wayland compositor, no display manager. The kernel provides DRM/KMS, veha-player renders directly to the display via dumb buffers.

## Components

### 1. DRM/KMS Output Backend (veha-output)

New output backend replacing framebuffer for the edge OS. Uses the `drm` crate (Smithay/drm-rs) with dumb buffers — no GPU acceleration required.

**File:** `veha-output/src/drm.rs`

**Flow:**
1. Open `/dev/dri/card0` (or scan `/dev/dri/card*`)
2. Find first connected connector, get preferred mode
3. Find available CRTC, create dumb buffer (XRGB8888)
4. Memory-map the buffer for direct pixel writes
5. `set_crtc()` to display the buffer
6. On each frame: convert RGB24 → XRGB8888, write to mmap'd buffer

**Feature gate:** `#[cfg(feature = "drm")]` in `veha-output/Cargo.toml`

**Dependencies:**
```toml
[dependencies.drm]
version = "0.14"
optional = true

[features]
drm = ["dep:drm"]
```

**Implements:** `OutputSink` trait (same as framebuffer/window backends)

**Why dumb buffers:** Works on any GPU with a KMS driver (Intel, AMD, RPi, Rockchip). No EGL/OpenGL. No GPU driver beyond the kernel module. Identical simplicity to the existing framebuffer backend but uses the modern kernel display path.

### 2. Archiso Profile (koompi-veha-edge-os/)

Custom archiso profile that produces a bootable installer ISO.

**Directory structure:**
```
koompi-veha-edge-os/
├── profiledef.sh                    # ISO metadata, boot modes, permissions
├── packages.x86_64                  # Packages for x86_64
├── packages.aarch64                 # Packages for aarch64
├── pacman.conf                      # Package repos
├── airootfs/                        # Root filesystem overlay
│   ├── opt/veha/
│   │   ├── veha-player              # Pre-compiled binary
│   │   ├── veha-agent               # Pre-compiled binary
│   │   └── veha-setup.sh            # First-boot configuration wizard
│   ├── etc/
│   │   ├── hostname                 # "veha-edge"
│   │   ├── locale.conf              # "LANG=en_US.UTF-8"
│   │   ├── vconsole.conf            # Console font/keymap
│   │   └── systemd/system/
│   │       ├── veha-player.service
│   │       ├── veha-agent.service
│   │       ├── veha-setup.service
│   │       └── multi-user.target.wants/
│   │           ├── veha-player.service → ../veha-player.service
│   │           ├── veha-agent.service  → ../veha-agent.service
│   │           ├── veha-setup.service  → ../veha-setup.service
│   │           └── NetworkManager.service → ...
│   └── root/
│       └── .automated_script.sh     # (optional) auto-login setup
├── efiboot/                         # UEFI systemd-boot config
│   └── loader/
│       ├── loader.conf
│       └── entries/
│           └── veha-edge.conf
└── syslinux/                        # BIOS boot config (x86_64)
    └── syslinux.cfg
```

### 3. Package List (minimal ~400MB)

```
# Base system
base
linux
linux-firmware
mkinitcpio
mkinitcpio-archiso

# System
systemd
sudo

# Network
networkmanager
openssh

# Display (DRM/KMS userspace)
mesa
libdrm

# Media (FFmpeg runtime)
ffmpeg

# Utilities
nano
htop
curl
```

No compiler, no desktop, no Xorg, no Wayland compositor.

### 4. First-Boot Wizard (veha-setup.sh)

Runs once on first boot via `veha-setup.service` (Type=oneshot, TTY attached).

**Prompts:**
1. API server URL (required)
2. Board ID (required)
3. Board name (defaults to board ID)
4. Resolution selection (1920x1080 / 1080x1920 / 3840x2160 / custom)
5. API key (optional)

**Actions:**
1. Writes `/opt/veha/veha-player.toml`
2. Writes `/opt/veha/veha-agent.toml`
3. Runs `systemctl disable veha-setup.service`
4. Runs `systemctl restart veha-player veha-agent`

**veha-setup.service:**
```ini
[Unit]
Description=Veha Edge First-Boot Setup
Before=veha-player.service veha-agent.service
ConditionPathExists=!/opt/veha/veha-agent.toml

[Service]
Type=oneshot
ExecStart=/opt/veha/veha-setup.sh
StandardInput=tty
StandardOutput=tty
TTYPath=/dev/tty1
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
```

Key: `ConditionPathExists=!` means it only runs when config doesn't exist yet. No need to disable itself — just the presence of the config file skips it on subsequent boots.

### 5. Player/Agent Services

**veha-player.service:**
```ini
[Unit]
Description=Veha Billboard Player
After=veha-setup.service
ConditionPathExists=/opt/veha/veha-player.toml

[Service]
Type=simple
ExecStart=/opt/veha/veha-player -c /opt/veha/veha-player.toml
WorkingDirectory=/opt/veha
Restart=always
RestartSec=5
User=root
SupplementaryGroups=video render
ExecStopPost=/bin/rm -f /tmp/veha-player.sock

[Install]
WantedBy=multi-user.target
```

**veha-agent.service:**
```ini
[Unit]
Description=Veha Billboard Agent
After=network-online.target veha-player.service
Wants=network-online.target
Requires=veha-player.service
ConditionPathExists=/opt/veha/veha-agent.toml

[Service]
Type=simple
ExecStart=/opt/veha/veha-agent -c /opt/veha/veha-agent.toml
WorkingDirectory=/opt/veha
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

## Build Process

### Build veha binaries

```bash
# x86_64 (native)
cargo build --release -p veha-player -p veha-agent --features drm

# aarch64 (cross-compile)
cross build --release -p veha-player -p veha-agent --features drm --target aarch64-unknown-linux-gnu
```

### Build ISO

```bash
# Copy binaries into profile
cp target/release/veha-player koompi-veha-edge-os/airootfs/opt/veha/
cp target/release/veha-agent  koompi-veha-edge-os/airootfs/opt/veha/

# Build x86_64 ISO
sudo mkarchiso -v -w /tmp/archiso-tmp -o dist/ koompi-veha-edge-os/

# Build aarch64 ISO (requires qemu-user-static for cross-arch pacstrap)
# Uses archiso-aarch64 fork or native aarch64 build host
```

### Makefile targets

```makefile
edge-os:       # builds binaries + ISO
edge-os-x86:   # x86_64 ISO only
edge-os-arm:   # aarch64 image only
```

## Flash & Deploy

```bash
# Write ISO to USB
sudo dd if=dist/koompi-veha-edge-os-x86_64.iso of=/dev/sdX bs=4M status=progress

# Boot from USB, first-boot wizard runs automatically
# After setup: board appears in dashboard, starts playing content
```

## Target Hardware

| Platform | Architecture | Display | Notes |
|----------|-------------|---------|-------|
| Mini PC / NUC | x86_64 | HDMI via Intel/AMD GPU | Primary target |
| Raspberry Pi 4/5 | aarch64 | HDMI via VideoCore | Popular SBC |
| Orange Pi 5 | aarch64 | HDMI via Rockchip | Cost-effective |
| Generic x86 thin client | x86_64 | HDMI/VGA via integrated GPU | Recycled hardware |

## Implementation Order

1. **DRM/KMS backend** — `veha-output/src/drm.rs` + feature gate + veha-player integration
2. **Archiso profile** — directory structure, profiledef.sh, package list, boot config
3. **First-boot wizard** — `veha-setup.sh` script + systemd service
4. **Service files** — veha-player.service, veha-agent.service with DRM permissions
5. **Build tooling** — Makefile targets for ISO generation
6. **Test** — boot ISO in QEMU, verify wizard + player startup + agent connection

## Dependencies

- `archiso` package (on build host)
- `drm` Rust crate v0.14 (Smithay/drm-rs)
- `qemu-user-static` (for cross-arch aarch64 builds on x86_64 host)
