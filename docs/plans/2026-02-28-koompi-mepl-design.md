# koompi-dooh Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

koompi-dooh is a Rust-based media player system wrapping FFmpeg, designed for three deployment targets:
1. **LED billboard/ad boards** — headless player with remote fleet management
2. **Desktop** — local testing and preview application
3. **Web** — management dashboard and browser-based player preview

## Architecture: Layered Cargo Workspace

```
koompi-dooh/
├── dooh-core/        # Library: FFmpeg wrapper, decoding, frame pipeline
├── dooh-output/      # Pluggable output backends (framebuffer, network, window)
├── dooh-player/      # Headless player service daemon
├── dooh-api/         # REST/WebSocket API server for fleet management
├── dooh-agent/       # Board agent: runs on each LED board
├── mepl-dashboard/   # Web dashboard frontend
├── dooh-cli/         # CLI tool for testing and management
└── dooh-web/         # WASM player for browser preview
```

## Components

### 1. dooh-core (Library)

FFmpeg wrapper via `ffmpeg-next` crate with:
- **Demuxing**: files (MP4/MKV/AVI), streams (RTSP/RTMP/HLS), images (PNG/JPG)
- **Decoding**: video to RGB/YUV, audio to PCM, hardware accel (VAAPI/V4L2M2M)
- **Frame pipeline**: Source -> Transform -> Sink architecture
- **Playlist engine**: ordered media items with duration, transitions, scheduling
- **Clock/sync**: PTS-based frame-accurate timing

Key traits:
```rust
pub trait OutputSink: Send {
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()>;
    fn write_audio(&mut self, samples: &AudioBuffer) -> Result<()>;
    fn resolution(&self) -> (u32, u32);
}
```

### 2. dooh-output (Library)

Pluggable output backends, feature-gated:
- **Framebuffer/DRM**: for LED boards via HDMI (`drm-rs`)
- **Window**: desktop preview (`minifb` or `sdl2`)
- **Network**: raw frames over TCP/UDP for remote LED controllers
- **WASM/Canvas**: browser rendering via `web-sys`
- **Null**: testing backend

### 3. dooh-player (Binary)

Headless daemon for each board:
- Embeds dooh-core + output backend
- Local Unix socket for agent communication
- Watchdog with auto-restart and fallback playlist
- Graceful media transitions (fade, cut)
- Playback event logging

### 4. dooh-agent (Binary)

Runs on each LED board alongside the player:
- Persistent WebSocket connection to central API (auto-reconnect)
- Receives commands: play, pause, skip, load playlist, update schedule
- Reports status: current media, health metrics (CPU/mem/temp), uptime, screenshots
- Local media cache with sync
- Offline mode: continues playing on connection loss

### 5. dooh-api (Binary)

Central fleet management server:
- REST API (axum) for CRUD: boards, playlists, media, schedules
- WebSocket for real-time agent communication and live control
- Auth: API key + JWT
- Storage: SQLite (sqlx) for metadata, filesystem for media
- Board grouping for batch operations

### 6. mepl-dashboard (Frontend)

Web SPA served by API server:
- Board map/list with real-time status
- Media library with upload/preview
- Drag-and-drop playlist editor
- Calendar-based schedule editor
- Live board preview (screenshots)
- Group management

### 7. dooh-cli (Binary)

Command-line interface:
- Local playback: `mepl play video.mp4`
- Board management: `mepl boards list`, `mepl boards push`
- Media upload: `mepl upload file.mp4`
- Diagnostics: `mepl status board-42`

### 8. dooh-web (WASM Library)

Browser player for preview:
- dooh-core compiled to WASM
- Canvas API / WebCodecs rendering
- Limited to browser-decodable formats

## Data Flow

```
Dashboard (Web UI) <--REST/WS--> API Server <--WebSocket--> Agent 1..N
                                                              |
                                                          Player 1..N
                                                              |
                                                          LED Board 1..N
```

## Key Dependencies

| Crate | Purpose |
|-------|---------|
| ffmpeg-next | FFmpeg bindings |
| tokio | Async runtime |
| axum | HTTP/WebSocket server |
| serde/serde_json | Serialization |
| sqlx | SQLite |
| drm-rs | DRM/KMS output |
| minifb | Window output |
| wasm-bindgen/web-sys | WASM target |
| tracing | Logging |
| clap | CLI |
| uuid | IDs |

## Build Phases

1. dooh-core — FFmpeg decoding
2. dooh-output — window backend
3. dooh-player — headless daemon
4. dooh-cli — local testing
5. dooh-api — REST/WebSocket server
6. dooh-agent — board agent
7. mepl-dashboard — web UI
8. dooh-output framebuffer — LED output
9. dooh-web — WASM player
