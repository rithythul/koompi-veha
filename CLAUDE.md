# CLAUDE.md — koompi-veha

## Working Mode

The user is on the backseat. Claude agents are the driver team: system architect, security expert, fullstack engineering team, UI/UX experts, business analyst, business dev, and product owner. A team of experts that come together to build the project with and for the user. The user verifies occasionally — agents make decisions, drive implementation, and own quality. Be proactive, thorough, and ship production-ready work.

## Project Overview

Rust Digital Out-of-Home (DOOH) advertising platform for LED billboard fleet management. FFmpeg-based media playback with full advertising workflow: zones, advertisers, campaigns, bookings, schedule resolution, play-log analytics. Cargo workspace, 7 crates.

## Quick Start

```bash
# Prerequisites: Rust 1.85+ (edition 2024), FFmpeg 8+ dev libs, bun 1.3+
# FFmpeg libs: libavcodec, libavformat, libavutil, libswscale, libswresample

cargo build --workspace                           # build all crates
cargo test --workspace                            # all tests
cargo test -p veha-core -- decoder                # single test by name
cd veha-dashboard && bun install && bun run dev   # dashboard dev server (:5173)

# Run API server (auto-creates DB + media dir + default admin on first run)
RUST_LOG=info cargo run -p veha-api -- --bind 0.0.0.0:3000 --database veha.db --media-dir media

# Deploy dashboard → API server
cd veha-dashboard && bun run build && cp -r dist/* ../static/

# Deploy edge device
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 ./veha-edge install

# Reset dev database (delete and restart — auto-migrates + creates admin)
rm veha.db && cargo run -p veha-api -- --bind 0.0.0.0:3000
```

**Environment variables:** `VEHA_API_KEY` (optional agent auth key), `RUST_LOG` (tracing filter).

## Architecture

Dashboard (React SPA) ↔ REST/WS ↔ API Server (axum + SQLite) ↔ WebSocket ↔ Agent (edge device) ↔ IPC ↔ Player (FFmpeg) ↔ LED/HDMI

```
veha-core       Library: FFmpeg decoder, frames, playlist, player, PlayerCommand/PlayerStatus
veha-output     Library: OutputSink backends (window/framebuffer/null, feature-gated)
veha-cli        Binary: CLI tool (play, upload, board management)
veha-player     Binary: headless player daemon (tokio + blocking FFmpeg thread)
veha-api        Binary: REST/WS API server (axum, sqlx, SQLite, inline migrations)
veha-agent      Binary: edge device agent (WS client, IPC to player, remote terminal via portable-pty)
veha-dashboard  React SPA (Vite, TypeScript, Tailwind CSS 4, TanStack Query v5, Zustand v5)
veha-web        WASM browser player (no veha-core dep — reimplements playlist only)
```

### Data Model

Booking ties Campaign to Board with time range + priority. Resolver merges active bookings into a resolved playlist per board. Creatives reference Media files. PlayLogs track actual playback.

```
Zone (hierarchical) ──┐
                      ├──► Board ◄── Group (flat, logical)
Advertiser → Campaign → Booking ──┘
                │                     PlayLog ◄── Board
                └──► Creative → Media
                                      Alert ◄── Board (screenshot anomaly)
```

### Key Decisions

- **ffmpeg-next = "8"** — must match system FFmpeg 8.x. Downgrading breaks ABI (symbol mismatches at link time).
- **OutputSink has no `Send` bound** — minifb::Window is !Send on X11. Sinks run on main thread.
- **Decoder is Iterator** — `Iterator<Item = Result<VideoFrame>>` for ergonomic frame consumption.
- **veha-web does NOT depend on veha-core** — FFmpeg can't compile to WASM.
- **WsMessage is duplicated** in `veha-api/src/ws.rs` and `veha-agent/src/ws_client.rs`. Not shared to avoid circular deps. **Must keep both in sync** — adding a variant to one without the other causes silent deserialization failures.
- **SQLite migrations are inline** — `include_str!` in `db.rs`, run sequentially at startup. No migration tool.
- **SPA routing** — `ServeDir` with `.fallback()` returning 200 + index.html. Using `not_found_service` returns 404 status (breaks client-side routing).

## API Reference

Endpoints are defined in `veha-api/src/routes.rs` → `create_router()`. Key patterns:

- **Auth**: `POST /api/auth/login`, `/logout`, `GET /api/auth/me`. Cookie-based sessions (`veha_session`).
- **RBAC**: `Extension<User>` + `auth::require_role(&user, WRITE_ROLES)`. Roles: admin, operator, viewer.
- **Board commands**: `POST /api/boards/{id}/command` with `{"command": {"type": "Play"}}` (see `PlayerCommand` in `veha-core/src/command.rs`).
- **Group commands**: `POST /api/groups/{id}/command` — sends to all boards in group.
- **Media**: Upload via multipart `POST /api/media`, download `GET /api/media/{id}/download`, thumbnail `GET /api/media/{id}/thumbnail`.
- **Screenshots**: `GET /api/boards/{id}/screenshot` (latest), `/screenshots` (history, max 60/board), `/screenshot/meta`.

### WebSocket Endpoints

- `/ws/agent` — Agent ↔ API. Protocol: `WsMessage` enum in `ws.rs`. Agent registers with `{type: "Register", board_id, api_key?}`.
- `/ws/dashboard` — API → Dashboard broadcast. Messages: `BoardStatusChange`, `ScreenshotUpdated`, `AlertCreated`. Triggers TanStack Query cache invalidation.
- `/ws/terminal/{board_id}` — Remote PTY shell. API injects `session_id` — dashboard clients omit it. All I/O base64-encoded.

### Background Tasks (API Server)

Session cleanup (hourly), campaign expiry (hourly), offline board alerts (5 min), expiring campaign alerts (5 min).

## Edge Device Setup

```bash
# Download pre-built binary (pick your arch: x86_64-linux or aarch64-linux)
wget https://github.com/rithythul/koompi-veha/releases/latest/download/veha-edge-x86_64-linux -O veha-edge
chmod +x veha-edge
sudo SERVER_URL=http://192.168.1.17:3000 BOARD_ID=board-001 ./veha-edge install

# Update to latest
sudo veha-edge update

# Uninstall
sudo veha-edge uninstall

# Logs
journalctl -u veha-edge -f
```

Edge config (`/etc/veha/veha-edge.toml`) — all fields with defaults:
```toml
board_id = "board-001"                              # required
api_url = "ws://192.168.1.17:3000/ws/agent"         # required
api_key = ""                                        # must match server --api-key if set
board_name = "unnamed-board"
player_socket = "/run/veha/player.sock"
report_interval_secs = 10
screenshot_interval_secs = 60                       # 0 to disable
cache_dir = "/var/cache/veha"
output_backend = "framebuffer"                      # "framebuffer" | "window" | "null"
width = 1920
height = 1080
fullscreen = true
player_restart_delay_secs = 5
```

Note: `api_base_url` is auto-derived from `api_url` (`ws://` → `http://`, path stripped). Not a config field.

## Auth & Security

- **Default admin**: Auto-created if no users exist. Username `admin`, random password printed to server logs. Change immediately.
- **Agent auth**: Optional. Set `--api-key` or `VEHA_API_KEY` env on server. Agents include it in Register message.
- **API keys**: CRUD at `/api/api-keys` (admin only).

## Conventions

- Commits: conventional commits `feat(scope):`, `fix:`, `test:`, `docs:`. No co-author lines.
- Feature gates: `#[cfg(feature = "framebuffer")]`
- Errors: `veha_core::Error` (thiserror) → `veha_core::Result<T>`
- Configs: TOML + serde. API: JSON + `application/json`. IPC: newline-delimited JSON over Unix socket.
- Logging: `tracing` crate (`info!`, `warn!`, `error!`).
- Dashboard: domain-organized components (`components/boards/`, `components/campaigns/`, etc.).

## Common Tasks

**Add API endpoint:** Handler in `routes.rs`, DB fn in `db.rs`, model in `models.rs`, route in `create_router()`. Write endpoints need `Extension<User>` + `auth::require_role(&user, WRITE_ROLES)`.

**Add player command:** Variant in `veha-core/src/command.rs` `PlayerCommand`, handle in `veha-player/src/lib.rs`, update `WsMessage` in **both** `veha-api/src/ws.rs` and `veha-agent/src/ws_client.rs`.

**Add dashboard page:** Page in `pages/`, lazy import + route in `App.tsx`, nav entry in `components/layout/Sidebar.tsx`, API hooks in `api/`.

**Add output backend:** `veha-output/src/mybackend.rs` implementing `OutputSink`, feature gate in Cargo.toml + lib.rs, match arm in `veha-player/src/lib.rs`.

**Deploy dashboard:** `cd veha-dashboard && bun run build && cp -r dist/* ../static/`

**Deploy edge:** Download `veha-edge` binary from GitHub Releases, then `sudo SERVER_URL=... BOARD_ID=... ./veha-edge install`. Use `sudo veha-edge update` to upgrade, `sudo veha-edge uninstall` to remove.

## Gotchas

- **Playlist `name` is required**: `LoadPlaylist(json)` needs `{"name": "...", "items": [...], "loop_playlist": bool}`. Missing `name` → silent parse failure on player, no error surfaced.
- **`house_only` boards**: Resolver returns empty playlist. Must send `LoadPlaylist` directly via `/api/boards/{id}/command`.
- **Socket path is `/run/veha/player.sock`**: Note the `/veha/` subdirectory. Agent and player must agree.
- **Config field is `output_backend`**: Not `output`. Old examples may use wrong name.
- **Terminal relay injects session_id**: Dashboard WS clients don't include `session_id` in messages — the API adds it.
- **Screenshot CORS**: URLs contain board ID. Cross-origin setups must allow `/api/boards/{id}/screenshot*`.
