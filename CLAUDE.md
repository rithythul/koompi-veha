# CLAUDE.md — koompi-mepl

## Project Overview

koompi-mepl is a Rust media player system wrapping FFmpeg for LED billboard fleet management. It's a Cargo workspace with 7 crates.

## Architecture

```
  ┌─────────────────┐     REST/WS      ┌──────────────┐
  │   Dashboard     │◄────────────────►│   API Server  │
  │  (mepl-api/     │                  │  (mepl-api)   │
  │   static/)      │                  │  axum+SQLite  │
  └─────────────────┘                  └──────┬───────┘
                                              │ WebSocket
                                  ┌───────────┼───────────┐
                                  ▼           ▼           ▼
                            ┌──────────┐┌──────────┐┌──────────┐
                            │  Agent   ││  Agent   ││  Agent   │
                            │(mepl-    ││(mepl-    ││(mepl-    │
                            │ agent)   ││ agent)   ││ agent)   │
                            └────┬─────┘└────┬─────┘└────┬─────┘
                                 │ IPC       │ IPC       │ IPC
                            ┌────▼─────┐┌────▼─────┐┌────▼─────┐
                            │  Player  ││  Player  ││  Player  │
                            │(mepl-    ││(mepl-    ││(mepl-    │
                            │ player)  ││ player)  ││ player)  │
                            └────┬─────┘└────┬─────┘└────┬─────┘
                                 │           │           │
                            ┌────▼─────┐┌────▼─────┐┌────▼─────┐
                            │ LED/HDMI ││ LED/HDMI ││ LED/HDMI │
                            └──────────┘└──────────┘└──────────┘
```

## Build & Test

```bash
cargo build --workspace          # build everything
cargo test --workspace           # run all tests (11 tests)
cargo build -p mepl-player --features framebuffer  # with framebuffer support
cargo check -p mepl-web --target wasm32-unknown-unknown  # check WASM crate
```

FFmpeg 8+ dev libraries must be installed (libavcodec, libavformat, libavutil, libswscale, libswresample).

## Workspace Structure

```
koompi-mepl/
├── mepl-core/           # Library: FFmpeg decoder, frames, playlist, player, commands
│   └── src/
│       ├── lib.rs       # Re-exports: Decoder, VideoFrame, OutputSink, Player, Playlist, MediaItem
│       ├── decoder.rs   # FFmpeg video decoder (Iterator<Item = Result<VideoFrame>>)
│       ├── frame.rs     # VideoFrame (RGB24), extract_rgb24_data() helper
│       ├── sink.rs      # OutputSink trait (no Send bound)
│       ├── player.rs    # Player with playlist playback
│       ├── playlist.rs  # Playlist/MediaItem with JSON serde
│       ├── image.rs     # Single image decoding via FFmpeg
│       ├── command.rs   # PlayerCommand enum, PlayerStatus struct
│       └── error.rs     # Error type (thiserror)
├── mepl-output/         # Library: Output backends
│   └── src/
│       ├── window.rs    # minifb window (feature: "window", default)
│       ├── framebuffer.rs  # /dev/fb0 mmap (feature: "framebuffer")
│       └── null.rs      # NullSink for testing
├── mepl-cli/            # Binary: CLI tool
│   └── src/main.rs      # play, play-playlist, boards, media, playlists, upload
├── mepl-player/         # Binary: Headless player daemon
│   └── src/
│       ├── main.rs      # Tokio async + blocking FFmpeg thread
│       ├── config.rs    # TOML config (PlayerConfig)
│       └── ipc.rs       # Unix socket IPC server (JSON commands)
├── mepl-api/            # Binary: REST/WebSocket API server
│   ├── migrations/      # SQLite schema (001_init.sql)
│   ├── static/          # Web dashboard (index.html, app.js, style.css)
│   └── src/
│       ├── main.rs      # axum server entry point
│       ├── routes.rs    # All REST endpoints
│       ├── db.rs        # SQLite CRUD (sqlx, inline migrations)
│       ├── models.rs    # API data types (sqlx::FromRow)
│       └── ws.rs        # WebSocket agent handler
├── mepl-agent/          # Binary: Board agent
│   └── src/
│       ├── main.rs      # Entry point
│       ├── config.rs    # TOML config (AgentConfig)
│       ├── ws_client.rs # WebSocket client with auto-reconnect
│       └── player_client.rs  # Unix socket IPC client to mepl-player
└── mepl-web/            # WASM: Browser playlist player
    ├── src/lib.rs       # wasm-bindgen MeplPlayer (no mepl-core dep)
    └── demo.html        # Standalone demo page
```

## Key Architecture Decisions

- **ffmpeg-next v8** — matches system FFmpeg 8.0.1 on Arch. Do NOT downgrade.
- **OutputSink has no `Send` bound** — minifb::Window is not Send on Linux/X11. Player runs sinks on main thread.
- **Decoder is an Iterator** — `Decoder: Iterator<Item = Result<VideoFrame>>` for ergonomic frame consumption.
- **Frames are RGB24 internally** — `frame::extract_rgb24_data()` handles FFmpeg stride. Output backends convert (ARGB for window, BGRA for framebuffer).
- **mepl-player uses blocking thread + async tokio** — FFmpeg is synchronous, IPC is async. Shared state via `Arc<Mutex<>>`.
- **mepl-web does NOT depend on mepl-core** — FFmpeg can't compile to WASM. The WASM crate reimplements playlist/timing only, using browser-native `<video>` and `<img>`.
- **WsMessage is duplicated** in mepl-api and mepl-agent (not shared) to avoid circular dependencies.
- **SQLite via sqlx** — string-based queries (no compile-time checking), inline migrations in db.rs.
- **Dashboard is vanilla HTML/JS/CSS** — Tailwind via CDN, no build tools, served by axum `ServeDir`.

## Conventions

- Commit messages follow conventional commits: `feat(scope):`, `fix:`, `test:`, `docs:`
- Feature-gate optional backends: `#[cfg(feature = "framebuffer")]`
- Error type is `mepl_core::Error` (thiserror), propagated via `mepl_core::Result<T>`
- Configs are TOML files deserialized with serde
- API uses JSON throughout, `application/json` content type
- IPC protocol: newline-delimited JSON over Unix socket

## Common Tasks

**Add a new output backend:** Create `mepl-output/src/mybackend.rs`, implement `OutputSink` trait, add feature gate in Cargo.toml and lib.rs, add match arm in mepl-player/src/main.rs.

**Add a new API endpoint:** Add handler in `mepl-api/src/routes.rs`, add DB function in `db.rs` if needed, add model in `models.rs`, register route in `create_router()`.

**Add a new player command:** Add variant to `PlayerCommand` enum in `mepl-core/src/command.rs`, handle it in mepl-player/src/main.rs command processing loop, update WsMessage in both mepl-api/src/ws.rs and mepl-agent/src/ws_client.rs.

## Test Fixtures

Test media files are in `mepl-core/tests/fixtures/`:
- `test.mp4` — 2s 320x240 H.264 video (generated by FFmpeg testsrc)
- `test.png` — 320x240 blue PNG image

Tests use `CARGO_MANIFEST_DIR` for robust fixture paths.
