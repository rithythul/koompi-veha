# veha-edge Binary Installer Design

**Goal:** Replace the compile-on-device install flow with a single pre-built binary (`veha-edge`) that self-installs, runs the agent, supervises the player, and can update itself — reducing edge device setup from 10+ minutes to under 30 seconds.

**Architecture:** New `veha-edge` Rust crate in the workspace. Depends on refactored `veha-agent` and `veha-player` library crates. Spawns player as a subprocess of itself for process isolation. GitHub Actions CI produces pre-built binaries for x86_64 and aarch64.

**Tech Stack:** Rust 1.85+ (edition 2024), clap (subcommands), tokio (async runtime + process supervision), cross (aarch64 cross-compilation in CI), GitHub Actions + GitHub Releases.

---

## Section 1: Architecture & Codebase Structure

### New workspace member

`veha-edge` — single binary, subcommands:

| Command | Purpose |
|---|---|
| `veha-edge install` | First-time setup: copy self, write config, create systemd service |
| `veha-edge uninstall` | Remove service, configs, binary |
| `veha-edge run` | Main runtime (systemd entry point): agent + player supervision |
| `veha-edge player` | Player-only entry point (called by `run` as subprocess) |
| `veha-edge update` | Download latest binary from GitHub Releases, replace self |
| `veha-edge status` | Print current service + player state |

### Code sharing — library refactor

Both existing crates gain a `lib.rs` so `veha-edge` can import their logic without duplication:

- `veha-agent/src/lib.rs` — exposes `pub async fn run(config: AgentConfig)`
- `veha-agent/src/main.rs` — thin wrapper (unchanged external behavior)
- `veha-player/src/lib.rs` — exposes `pub fn run(config: PlayerConfig)`
- `veha-player/src/main.rs` — thin wrapper (unchanged external behavior)
- `veha-edge/src/main.rs` — subcommand dispatch, install logic, process supervision

`Cargo.toml` workspace gains `"veha-edge"` in `members`.

---

## Section 2: Installation Flow

### Command

```bash
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 ./veha-edge install
```

### Optional env vars

```bash
BOARD_NAME=lobby-screen      # human name (default: BOARD_ID)
OUTPUT_BACKEND=framebuffer   # window | framebuffer | null (default: framebuffer)
WIDTH=1920
HEIGHT=1080
API_KEY=secret               # if server uses --api-key
```

### Steps performed by `install`

1. Validate required env vars (SERVER_URL, BOARD_ID) — exit with clear error if missing
2. Create `/opt/veha/` and copy binary there as `veha-edge`
3. Create `/etc/veha/` and write `veha-edge.toml` from env vars
4. Write `/etc/tmpfiles.d/veha.conf` — ensures `/run/veha/` socket dir exists on boot
5. Create `/var/cache/veha/` for media cache
6. Write `/etc/systemd/system/veha-edge.service`
7. `systemctl daemon-reload && systemctl enable --now veha-edge`
8. Print confirmation with service status

### Systemd unit

```ini
[Unit]
Description=veha-edge board agent + player
After=network.target

[Service]
ExecStart=/opt/veha/veha-edge run
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

### `uninstall`

`systemctl disable --now veha-edge`, remove service file, `/opt/veha/`, `/etc/veha/`, tmpfiles config.
Pass `--purge` to also remove `/var/cache/veha/` (media cache).

---

## Section 3: Runtime Process Model

```
systemd
  └── veha-edge run          (main process: tokio async runtime, agent WS loop)
        └── veha-edge player (child process: blocking FFmpeg thread + OutputSink)
```

### Why subprocess

`OutputSink` is `!Send` on X11 (minifb). The player must own its thread exclusively. A subprocess provides the same isolation as the current two-service setup without requiring two separate binaries.

### Process supervision

1. `run` spawns `veha-edge player --config /etc/veha/veha-edge.toml` via `tokio::process::Command`
2. Monitors child exit — if it crashes, waits `player_restart_delay_secs` then restarts
3. Agent WS loop runs concurrently in the same tokio runtime
4. On SIGTERM → send SIGTERM to player child → 5s graceful wait → exit

### IPC

Unchanged: newline-delimited JSON over Unix socket at `/run/veha/player.sock`. Agent sends `PlayerCommand` variants (Play, Stop, LoadPlaylist, Screenshot) to player via this socket.

---

## Section 4: Config Format

Single file replaces two existing TOML configs:

```toml
# /etc/veha/veha-edge.toml

# Board identity
board_id = "board-001"
board_name = "lobby-screen"

# API connection
api_url = "ws://192.168.1.17:3000/ws/agent"
api_key = ""

# Player output
output_backend = "framebuffer"   # window | framebuffer | null
width = 1920
height = 1080
fullscreen = true

# Runtime paths
player_socket = "/run/veha/player.sock"
cache_dir = "/var/cache/veha"

# Timing
report_interval_secs = 10
screenshot_interval_secs = 60    # 0 = disabled
player_restart_delay_secs = 5
```

`veha-edge` deserializes this into a single `EdgeConfig` struct. The `run` subcommand splits it into `AgentConfig` and `PlayerConfig` for the respective library calls.

---

## Section 5: CI/CD (GitHub Actions)

### Workflow

File: `.github/workflows/release-edge.yml`
Trigger: `git tag v*` push

### Build matrix

| Target | Runner | Method |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` | native `cargo build --release -p veha-edge` |
| `aarch64-unknown-linux-gnu` | `ubuntu-latest` | `cross build --release -p veha-edge --target aarch64-unknown-linux-gnu` |

### Release artifacts

Uploaded to GitHub Releases:
- `veha-edge-x86_64-linux`
- `veha-edge-aarch64-linux`

### Self-update

```bash
sudo veha-edge update
```

Detects running arch from compiled-in target triple, downloads matching binary from latest GitHub Release, replaces `/opt/veha/veha-edge`, restarts service via `systemctl restart veha-edge`.

---

## Decision Log

- **Dynamic FFmpeg linking** — system `apt install ffmpeg` on device; no static linking complexity
- **Player as subprocess of self** — preserves `!Send` OutputSink isolation, single binary on disk
- **Library refactor over code duplication** — `veha-agent` and `veha-player` gain `[lib]` sections; `veha-edge` imports them
- **x86_64 + aarch64 only** — covers Intel NUC + modern ARM boards (RPi 4/5, Khadas VIM4, etc.)
- **`cross` for aarch64 cross-compilation** — avoids native ARM CI runner complexity
