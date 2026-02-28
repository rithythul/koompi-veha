# koompi-veha Phases 3-9 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the full fleet management system: headless player daemon, REST/WebSocket API, board agent with remote control, web dashboard, framebuffer output for LED boards, and WASM player preview.

**Architecture:** Extend the existing Cargo workspace with 5 new crates (veha-player, veha-api, veha-agent, veha-dashboard, veha-web) plus a framebuffer output backend in veha-output.

**Tech Stack:** Rust, tokio, axum, sqlx (SQLite), serde, tungstenite/tokio-tungstenite, drm-rs, wasm-bindgen

---

## Phase 3: Headless Player Daemon (veha-player)

### Task 1: Create veha-player crate with config and daemon skeleton

Create a headless player service that runs on each LED board.

**New crate: veha-player/**
- Config file (TOML): output backend, resolution, default playlist, API endpoint
- Daemon main loop: load config → init output → load playlist → play
- Signal handling: SIGTERM for graceful shutdown, SIGHUP for config reload
- Logging via tracing

### Task 2: IPC command channel

Add a Unix socket or channel-based command interface so the agent can control the player:
- Commands: Play, Pause, Resume, Stop, Skip, LoadPlaylist, SetVolume, GetStatus
- Use tokio mpsc channels internally, exposed via Unix domain socket
- JSON-based command protocol over the socket

### Task 3: Player state machine improvements

Enhance veha-core Player to support:
- Pause/Resume (currently only Playing/Stopped)
- Skip to next/previous item
- Thread-safe state via Arc<Mutex<>> or channels
- Status reporting (current item, position, total items)

---

## Phase 4: CLI Enhancements (veha-cli)

### Task 4: Board management CLI commands

Add subcommands:
- `veha boards list` — list boards from API
- `veha boards status <id>` — get board status
- `veha boards command <id> <cmd>` — send command to board
- `veha upload <file>` — upload media to API server
- `veha config` — configure API endpoint

---

## Phase 5: API Server (veha-api)

### Task 5: Create veha-api crate with axum skeleton

- axum HTTP server with CORS
- SQLite database via sqlx with migrations
- Config (bind address, media storage path, database path)

### Task 6: Database schema and models

Tables:
- boards (id, name, group_id, status, last_seen, config JSON)
- groups (id, name)
- media (id, name, filename, mime_type, size, uploaded_at)
- playlists (id, name, items JSON, loop, created_at, updated_at)
- schedules (id, board_id/group_id, playlist_id, start_time, end_time, days_of_week, priority)

### Task 7: REST API endpoints

CRUD endpoints:
- /api/media — upload, list, get, delete media files
- /api/playlists — create, list, get, update, delete playlists
- /api/boards — list, get, update boards (auto-registered by agents)
- /api/groups — create, list, add/remove boards
- /api/schedules — create, list, update, delete schedules
- /api/boards/{id}/command — send command to a board
- /api/groups/{id}/command — send command to all boards in group

### Task 8: WebSocket handler for agent connections

- /ws/agent — agents connect here with board_id
- Server tracks connected agents
- Bidirectional: server pushes commands, agent pushes status
- Heartbeat/ping-pong for connection health
- Agent authentication via API key

### Task 9: API authentication

- Simple API key auth for agents (header-based)
- JWT tokens for dashboard users
- Middleware for auth checking

---

## Phase 6: Board Agent (veha-agent)

### Task 10: Create veha-agent crate

Agent binary that runs on each LED board alongside veha-player:
- Config: board_id, API server URL, API key, player socket path
- WebSocket client connecting to API server (auto-reconnect)
- Forwards commands from API to local player via Unix socket
- Reports player status back to API

### Task 11: Media sync and caching

- On playlist load, download any missing media files from API
- Local media cache directory
- Cache eviction (LRU or size-based)

### Task 12: Health monitoring and reporting

- Periodic status reports to API: CPU, memory, temperature, disk, uptime
- Current playback state
- Screenshot capability (capture current frame)

---

## Phase 7: Web Dashboard (veha-dashboard)

### Task 13: Dashboard static files served by API

Minimal but functional web dashboard:
- Single-page app using vanilla JS + Tailwind CSS (no build tools)
- Served as static files by the axum API server
- Pages: Boards, Playlists, Media, Schedules

### Task 14: Dashboard pages

- Board list with real-time status (via WebSocket)
- Media library with upload
- Playlist editor
- Schedule editor (simple form-based)

---

## Phase 8: Framebuffer/DRM Output

### Task 15: DRM/Framebuffer output backend

Add to veha-output:
- Feature-gated `framebuffer` backend
- Direct framebuffer write via /dev/fb0 (simpler, works everywhere)
- Fallback from DRM to framebuffer
- Resolution auto-detection

---

## Phase 9: WASM Player

### Task 16: WASM player crate

veha-web crate:
- Compile subset of veha-core to WASM
- Canvas-based rendering via web-sys
- JavaScript API for control
- Note: Full FFmpeg in WASM is complex; start with a simplified version that plays pre-decoded frames or uses browser-native video decoding

---

## Build Order

Tasks 1-3 → Tasks 5-9 → Tasks 10-12 → Task 4 → Tasks 13-14 → Task 15 → Task 16

(Player daemon first, then API server, then agent, then CLI updates to use API, then dashboard, then hardware output and WASM)
