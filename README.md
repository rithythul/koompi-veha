# koompi-veha

A Rust-based media player system wrapping FFmpeg, designed for managing fleets of LED billboard and digital signage displays with remote control.

## Architecture

```
  ┌─────────────────┐     REST/WS      ┌──────────────┐
  │   Dashboard     │◄────────────────►│   API Server  │
  │  (veha-api/     │                  │  (veha-api)   │
  │   static/)      │                  │  axum+SQLite  │
  └─────────────────┘                  └──────┬───────┘
                                              │ WebSocket
                                  ┌───────────┼───────────┐
                                  ▼           ▼           ▼
                            ┌──────────┐┌──────────┐┌──────────┐
                            │  Agent   ││  Agent   ││  Agent   │
                            │(veha-    ││(veha-    ││(veha-    │
                            │ agent)   ││ agent)   ││ agent)   │
                            └────┬─────┘└────┬─────┘└────┬─────┘
                                 │ IPC       │ IPC       │ IPC
                            ┌────▼─────┐┌────▼─────┐┌────▼─────┐
                            │  Player  ││  Player  ││  Player  │
                            │(veha-    ││(veha-    ││(veha-    │
                            │ player)  ││ player)  ││ player)  │
                            └────┬─────┘└────┬─────┘└────┬─────┘
                                 │           │           │
                            ┌────▼─────┐┌────▼─────┐┌────▼─────┐
                            │ LED/HDMI ││ LED/HDMI ││ LED/HDMI │
                            └──────────┘└──────────┘└──────────┘
```

The system is a Cargo workspace with 7 crates:

| Crate | Type | Purpose |
|-------|------|---------|
| **veha-core** | library | FFmpeg decoder, video frames, playlist engine, player logic |
| **veha-output** | library | Output backends: window (minifb), framebuffer (/dev/fb0), null |
| **veha-cli** | binary | CLI for local playback and remote board management |
| **veha-player** | binary | Headless player daemon that runs on each board |
| **veha-api** | binary | Central REST/WebSocket API server (axum + SQLite) |
| **veha-agent** | binary | Board agent connecting to API and controlling local player |
| **veha-web** | cdylib | WASM playlist player for browser-based preview |

## Quick Install

### Central Server (one-liner)

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-server.sh | sudo bash
```

Installs the API server + dashboard to `/opt/veha`, creates a systemd service, and prints the admin credentials.

### Billboard Edge Device (one-liner)

```bash
curl -sSfL https://raw.githubusercontent.com/rithythul/koompi-veha/main/scripts/install-edge.sh | sudo bash
```

Installs the agent + player on billboard hardware. Prompts for server URL, board ID, display resolution, and output backend. Sets up systemd services that auto-start on boot.

### Build Release Tarballs

```bash
make server   # builds veha-api + dashboard → dist/veha-server-*.tar.gz
make edge     # builds veha-agent + veha-player → dist/veha-edge-*.tar.gz
make all      # both
```

---

## Prerequisites (manual build)

- Rust 1.75+ (edition 2024)
- FFmpeg 8+ libraries (`libavcodec`, `libavformat`, `libavutil`, `libswscale`, `libswresample`)
- pkg-config

### Install FFmpeg dev libraries

**Arch Linux:**
```bash
sudo pacman -S ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev pkg-config
```

**macOS:**
```bash
brew install ffmpeg pkg-config
```

## Quick Start

### Build

```bash
cargo build --release
```

### Play a video locally

```bash
cargo run -p veha-cli --release -- play video.mp4
cargo run -p veha-cli --release -- play video.mp4 --width 1280 --height 720
```

### Play a playlist

Create a playlist JSON file:

```json
{
  "name": "My Ads",
  "items": [
    { "source": "promo.mp4", "duration": null, "name": "Promo Video" },
    { "source": "banner.png", "duration": { "secs": 5, "nanos": 0 }, "name": "Banner" },
    { "source": "rtsp://camera/live", "duration": { "secs": 30, "nanos": 0 }, "name": "Live Feed" }
  ],
  "loop_playlist": true
}
```

```bash
cargo run -p veha-cli --release -- play-playlist playlist.json --width 1920 --height 1080
```

## Fleet Deployment

### 1. Start the API Server

```bash
cargo run -p veha-api --release -- --bind 0.0.0.0:3000 --database veha.db --media-dir ./media
```

The web dashboard is available at `http://your-server:3000`.

### 2. On Each LED Board

Create `veha-player.toml`:

```toml
output_backend = "framebuffer"  # "window" for testing, "framebuffer" for LED boards
width = 1920
height = 1080
socket_path = "/tmp/veha-player.sock"
default_playlist = "default-ads.json"  # optional
```

Create `veha-agent.toml`:

```toml
board_id = "board-lobby-01"
board_name = "Lobby Screen"
api_url = "ws://your-server:3000/ws/agent"
api_key = ""
player_socket = "/tmp/veha-player.sock"
report_interval_secs = 10
cache_dir = "/tmp/veha-cache"
```

Start both services:

```bash
cargo run -p veha-player --release -- --config veha-player.toml &
cargo run -p veha-agent --release -- --config veha-agent.toml &
```

For production, use systemd services or similar process management.

### 3. Remote Control via CLI

```bash
# Set API URL (or pass --api-url each time)
export VEHA_API=http://your-server:3000

veha boards list --api-url http://your-server:3000
veha boards command board-lobby-01 pause --api-url http://your-server:3000
veha boards command board-lobby-01 play --api-url http://your-server:3000
veha boards command board-lobby-01 next --api-url http://your-server:3000
veha upload new-ad.mp4 --api-url http://your-server:3000
veha playlists create "Q1 Campaign" --items ad1.mp4,ad2.mp4,banner.png --loop --api-url http://your-server:3000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/boards` | List all boards |
| GET | `/api/boards/{id}` | Get board details |
| POST | `/api/boards` | Register a board |
| POST | `/api/boards/{id}/command` | Send command to board |
| GET | `/api/groups` | List board groups |
| POST | `/api/groups` | Create a group |
| POST | `/api/groups/{id}/command` | Send command to all boards in group |
| GET | `/api/media` | List uploaded media |
| POST | `/api/media` | Upload media file (multipart) |
| GET | `/api/media/{id}/download` | Download media file |
| DELETE | `/api/media/{id}` | Delete media |
| GET | `/api/playlists` | List playlists |
| POST | `/api/playlists` | Create playlist |
| GET | `/api/playlists/{id}` | Get playlist |
| PUT | `/api/playlists/{id}` | Update playlist |
| DELETE | `/api/playlists/{id}` | Delete playlist |
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create schedule |
| DELETE | `/api/schedules/{id}` | Delete schedule |
| GET | `/ws/agent` | WebSocket endpoint for board agents |

## Player Commands

Commands that can be sent to boards via the API or CLI:

- `Play` / `Resume` — start or resume playback
- `Pause` — pause playback
- `Stop` — stop playback
- `Next` — skip to next playlist item
- `Previous` — go to previous playlist item
- `GetStatus` — query current player state
- `LoadPlaylist(json)` — load a new playlist

## Output Backends

- **window** (default) — desktop window via minifb, for testing and preview
- **framebuffer** — direct `/dev/fb0` writes via mmap, for LED boards connected via HDMI. Supports 16bpp (RGB565), 24bpp (BGR24), and 32bpp (BGRA32). Build with: `cargo build -p veha-player --features framebuffer`
- **null** — discards frames, for testing and benchmarking

## WASM Player Preview

For browser-based playlist preview:

```bash
cargo install wasm-pack
wasm-pack build veha-web --target web --out-dir pkg
# Serve veha-web/demo.html with any HTTP server
```

## Supported Media Formats

Everything FFmpeg supports, including:
- Video: MP4, MKV, AVI, WebM (H.264, H.265, VP9, AV1)
- Images: PNG, JPG, BMP, WebP, TIFF
- Streams: RTSP, RTMP, HLS, HTTP

## Testing

```bash
cargo test --workspace
```

## License

MIT
