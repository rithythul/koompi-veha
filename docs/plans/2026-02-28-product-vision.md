# koompi-veha Product Vision Paper

**Date:** 2026-02-28
**Audience:** Internal team / Engineering
**Status:** Draft

---

## 1. Product Identity

### What veha Is

**veha** (Media Player) is a distributed digital signage fleet management platform built in Rust. It decodes and renders media on headless display hardware (LED billboards, HDMI screens) via FFmpeg, and provides centralized remote control over fleets of any size through a WebSocket-connected agent architecture.

### The Problem

Operating a fleet of LED billboards or digital displays involves three hard problems:

1. **Reliable playback on constrained hardware.** LED controller boards are typically low-power ARM or embedded x86 devices. They need a media player that starts on boot, plays video/image playlists at native framebuffer resolution, and runs indefinitely without memory leaks, crashes, or X11 dependencies.

2. **Remote fleet orchestration.** An operator managing 10, 100, or 1,000 screens in different physical locations needs to push content updates, change playlists, send play/pause commands, and monitor board health — all without physical access to each device.

3. **Content management lifecycle.** Media files need to be uploaded, organized into playlists, scheduled across time slots and days, and assigned to individual boards or groups — a workflow that sits between "copy files to a USB stick" and "enterprise CMS costing six figures."

### Core Thesis

> A Rust-native media player with direct framebuffer rendering, paired with a lightweight agent-server architecture, can deliver enterprise-grade digital signage fleet management at a fraction of the resource cost and operational complexity of existing solutions.

veha trades the heavyweight approach (Java/.NET CMS, Chrome/Electron-based players, containerized media servers) for a minimal, purpose-built stack: FFmpeg for decoding, mmap'd framebuffer for output, Unix sockets for local IPC, WebSockets for remote control, and SQLite for state.

---

## 2. Use Cases & Target Markets

### Primary: Digital Out-of-Home (veha) Advertising

The core use case veha is built for today. An advertising operator manages a network of LED billboards displaying rotating ad content.

**Workflow:**
- Upload ad creatives (video, images) to the central API server
- Create playlists grouping ads into rotation sequences
- Assign playlists to boards or board groups
- Schedule playlists by time-of-day and day-of-week
- Monitor board health (online/offline, current playback status)
- Send live commands (pause during emergencies, skip to next ad)

**Why veha fits:** Direct framebuffer rendering matches LED controller hardware. Low resource footprint means commodity SBCs (Raspberry Pi, Orange Pi, KOOMPI boards) can drive displays. The agent auto-reconnects, so boards work autonomously when network drops.

### Secondary: Retail & Hospitality Digital Signage

In-store displays showing promotions, restaurant menu boards, hotel lobby information screens.

**Differentiator vs. primary:** Smaller fleet sizes (5-50 screens) but higher content change frequency. Scheduling matters more (lunch specials, happy hour promotions). The web dashboard serves as the primary interface for non-technical store managers.

### Tertiary: Public Information & Smart Campus

Transit arrival boards, university campus announcements, government public messaging.

**Differentiator:** RTSP/RTMP/HLS live stream support is critical here — displaying a live camera feed alongside announcement slides. veha already handles this via FFmpeg's stream input support.

### Future: Interactive & Sensor-Driven Displays

Displays that react to foot traffic, weather data, or audience demographics. This requires extending the command protocol and adding sensor data ingest — not yet built, but the agent architecture supports it.

---

## 3. Current State Assessment

### What's Built (as of February 2026)

| Component | Status | Maturity |
|-----------|--------|----------|
| **veha-core** (decoder, frames, playlist, player) | Functional | Solid — well-tested, clean Iterator-based API |
| **veha-output/window** (minifb desktop) | Functional | Good for development/testing |
| **veha-output/framebuffer** (Linux fb0) | Functional | Production-ready for 16/24/32bpp boards |
| **veha-output/null** (test sink) | Functional | Complete |
| **veha-player** (headless daemon) | Functional | Core loop works; needs resilience hardening |
| **veha-agent** (board agent) | Functional | Auto-reconnect works; needs media caching |
| **veha-api** (REST + WebSocket server) | Functional | Full CRUD; single-instance only |
| **veha-cli** (command-line tool) | Functional | Covers all API operations |
| **veha-web** (WASM preview) | Functional | Browser preview only, no FFmpeg |
| **Dashboard** (web UI) | Functional | Vanilla JS, covers core workflows |
| **Scheduling** | Schema exists | DB schema present, enforcement logic not in agent |

### Architecture Strengths

**Performance characteristics:**
- Rust eliminates GC pauses during playback — critical for smooth video on LED panels
- Direct framebuffer writes via mmap bypass compositor overhead entirely
- FFmpeg Iterator pattern enables zero-copy frame pipeline with predictable memory usage
- The player daemon's memory footprint is dominated by a single decoded frame buffer (~6MB for 1080p RGB24)

**Operational model:**
- Agent-server architecture scales horizontally: adding a board = deploying agent+player binaries and pointing at the API server
- WebSocket with auto-reconnect makes boards resilient to network interruptions
- Unix socket IPC cleanly separates the player process from the agent, enabling independent restart/upgrade
- TOML configuration makes fleet provisioning scriptable

**Code quality:**
- Clean workspace separation: 2 libraries (pure logic) + 5 binaries (deployment units)
- 11 tests covering core decoder, frame conversion, playlist serialization
- `thiserror`-based error types with proper propagation throughout
- Feature-gated output backends prevent unnecessary dependencies

### Known Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| No media caching on agents | Boards re-download media on every playlist load | High |
| Single API server instance | No HA, restarting API disconnects all agents | High |
| Schedule enforcement missing | DB schema exists but agents don't check schedules | Medium |
| No authentication/authorization | API is open; agent `api_key` field unused | High |
| No content verification | No checksum/integrity check for media transfers | Medium |
| No OTA update mechanism | Updating player/agent requires manual deployment | Medium |
| No metrics/telemetry pipeline | Board health is last-seen timestamp only | Medium |
| No audit logging | No record of who changed what and when | Low |
| Dashboard is basic | No real-time status updates via WebSocket | Low |
| Limited error recovery in player | Decoder errors can stall playback loop | Medium |

---

## 4. Competitive Landscape

### Existing Solutions

| Product | Model | Strengths | Weaknesses vs. veha |
|---------|-------|-----------|---------------------|
| **Xibo** | Open source (PHP/Java) | Mature CMS, large community, layout designer | Heavyweight (requires Docker, Spring Boot); player is C#/.NET on Windows or Android-dependent |
| **Screenly** | Commercial + OSS (Python) | Easy Raspberry Pi deployment, cloud management | Chromium-based player (web content only, high resource usage); per-screen pricing |
| **BrightSign** | Hardware + software | Purpose-built hardware, very reliable | Proprietary, vendor lock-in, expensive per unit |
| **Scala/Stratacache** | Enterprise | Feature-complete enterprise CMS | Very expensive, complex deployment, overkill for <500 screens |
| **Rise Vision** | SaaS (Chrome) | Easy to start, runs in ChromeOS/Chrome | Requires Chrome browser, no framebuffer mode, SaaS dependency |
| **Yodeck** | SaaS + RPi | Low entry cost, Pi-based | SaaS lock-in, limited offline capability, Chromium player |

### Where veha Fits

veha occupies a space that currently has no direct occupant:

```
                        Resource usage
                   Low ◄────────────────► High
                    │                      │
  Self-hosted   ────┤  ★ veha             │
                    │                      │  Xibo
                    │                      │
                    │  Screenly OSS        │
                    │                      │
  Managed/SaaS ────┤                      │
                    │  Yodeck    Rise Vision│
                    │  Screenly Pro        │
                    │                      │
  Appliance    ────┤                      │
                    │  BrightSign          │  Scala
                    │                      │
```

**veha's unique position:** Self-hosted, low-resource, framebuffer-native, Rust-native. No existing solution offers this combination. The closest competitor is Screenly OSS, but it uses Chromium for rendering (order-of-magnitude more resources, no direct framebuffer support).

---

## 5. Technical Differentiators

### 1. Framebuffer-Native Rendering

Most digital signage players render content through a browser engine (Chromium) or a GUI toolkit. veha writes directly to `/dev/fb0` via memory-mapped I/O. This means:

- **No X11/Wayland required.** The board boots to a bare Linux kernel + veha-player. No display server, no compositor, no desktop environment.
- **Predictable latency.** Frame delivery is a memcpy to a mapped file descriptor. No compositor vsync, no GPU context switching.
- **Minimal attack surface.** No browser engine = no JavaScript execution = no web-based vulnerabilities on the display hardware.
- **Resource footprint.** Player daemon: ~20MB RSS for 1080p playback. Compare to Chromium-based: 200-500MB.

### 2. Rust Memory Safety Without GC Overhead

Rust's ownership model gives veha two guarantees simultaneously:
- **No memory leaks** in long-running daemon processes (billboards run 24/7 for months)
- **No GC pauses** during frame delivery (critical for smooth video on LED panels where frame drops are visible as flicker)

### 3. FFmpeg as Universal Codec Layer

By wrapping FFmpeg rather than reimplementing codecs or depending on browser codecs:
- Supports every major video/image format (H.264, H.265, VP9, AV1, MJPEG, PNG, JPEG, WebP, etc.)
- Supports network streams (RTSP, RTMP, HLS, HTTP) for live content
- Hardware acceleration (VA-API, NVDEC) available through FFmpeg's existing abstraction
- Codec support evolves with FFmpeg updates, not veha releases

### 4. Agent Architecture with Process Isolation

The agent and player are separate processes communicating over Unix sockets. This design provides:
- **Independent lifecycle.** Restart the agent without interrupting playback. Update the player without dropping the WebSocket connection.
- **Fault isolation.** An FFmpeg crash in the player doesn't bring down the agent's connection to the API server.
- **Security boundary.** The player accesses framebuffer hardware; the agent accesses the network. Different privilege profiles.

### 5. Lightweight Coordination Protocol

The entire system communicates through two protocols:
- **IPC:** Newline-delimited JSON over Unix socket (local, zero-overhead)
- **Remote:** WebSocket with JSON messages (one persistent connection per board)

No message broker, no MQTT, no gRPC — just WebSocket. This is appropriate for the command-and-control pattern where the server pushes commands and agents push status. The reconnection logic in the agent handles network unreliability.

---

## 6. Architecture Vision

### Current Architecture

```
         Dashboard ──► API Server (single) ──► SQLite
                           │
                   WebSocket (N connections)
                     │     │     │
                   Agent  Agent  Agent
                     │     │     │
                   Player Player Player  (Unix IPC)
                     │     │     │
                   fb0    fb0   fb0
```

### Target Architecture (Evolution Path)

```
Phase 1: Production-Ready                Phase 2: Scale-Out
──────────────────────                   ────────────────────
┌─────────────────────┐                  ┌─────────────────────────────┐
│  Dashboard (SPA)    │                  │  Dashboard (SPA)            │
│  + live WebSocket   │                  │  + multi-tenant             │
└──────────┬──────────┘                  └──────────────┬──────────────┘
           │                                            │
┌──────────▼──────────┐                  ┌──────────────▼──────────────┐
│   API Server        │                  │   API Server (clustered)    │
│  + Auth (JWT/API)   │                  │  + Redis session store      │
│  + Media checksums  │                  │  + S3-compatible media      │
│  + Schedule engine  │                  │  + PostgreSQL               │
│  + Audit logging    │                  │  + Audit + metrics pipeline │
└──────────┬──────────┘                  └──────────────┬──────────────┘
           │                                            │
     WebSocket (N)                              WebSocket (N x M)
       │  │  │                              (load-balanced, sticky)
     Agent Agent Agent                        │    │    │    │    │
       │    │    │                          Agent Agent Agent Agent Agent
     Player Player Player                     │    │    │    │    │
       │    │    │                          Player...
      fb0  fb0  fb0                           │
                                             fb0...
```

### Phase 1: Production Hardening

The current codebase is functionally complete for small deployments. Phase 1 focuses on making it reliable for production use with 10-100 boards.

**Authentication & Authorization**
- JWT-based authentication for dashboard users and CLI
- API key authentication for agents (the `api_key` config field already exists)
- Role-based access: admin (full control), operator (commands only), viewer (read-only)

**Media Caching on Agents**
- Agent downloads media files to `cache_dir` on playlist assignment
- Content-addressed storage: `SHA256(file) → filename` prevents re-downloads
- Server includes content hash in playlist metadata
- Agent validates cached files before playback

**Schedule Enforcement**
- Agent periodically fetches its schedule from the API
- Local schedule evaluation determines which playlist to play at current time
- Priority-based conflict resolution when schedules overlap
- Fallback to default playlist when no schedule is active

**Player Resilience**
- Watchdog: agent restarts player process if it becomes unresponsive
- Graceful decoder error handling: skip corrupted frames, advance to next item
- Configurable retry on stream connection failures (RTSP/RTMP)

**Operational Observability**
- Structured logging via `tracing` (already used) with JSON output
- Board uptime, playback errors, and media download stats reported to server
- API endpoint for fleet health summary

### Phase 2: Scale-Out

For deployments beyond 100 boards or multi-tenant operation.

**Database migration:** SQLite → PostgreSQL for concurrent write handling and replication.

**Media storage:** Local filesystem → S3-compatible object storage (MinIO for self-hosted, AWS S3 for cloud). Media served via presigned URLs or CDN.

**API clustering:** Multiple API server instances behind a load balancer. WebSocket connections require sticky sessions (based on board_id). Shared state via Redis.

**Multi-tenancy:** Tenant isolation at the API level. Each tenant manages their own boards, media, and playlists. Shared infrastructure, separated data.

### Phase 3: Edge Intelligence (Future)

- Content pre-positioning based on schedule (agent fetches tomorrow's media overnight)
- Proof-of-play reporting (verifiable records that specific content played at specific times — required for advertising billing)
- Sensor integration hooks (audience counting, environmental triggers)
- Content approval workflows

---

## 7. Product Roadmap

Prioritized by impact and dependency order. No time estimates — the team decides pacing.

### Tier 1: Production Blockers

These must be resolved before deploying to paying customers.

| # | Feature | Crates Affected | Depends On |
|---|---------|----------------|------------|
| 1 | **API authentication (JWT + API key)** | veha-api, veha-agent, veha-cli | — |
| 2 | **Agent media caching** | veha-agent, veha-api (add content hash to media/playlist API) | — |
| 3 | **Schedule enforcement in agent** | veha-agent | — |
| 4 | **Player error recovery** (skip bad frames, retry streams) | veha-core, veha-player | — |
| 5 | **TLS/HTTPS support** | veha-api (reverse proxy config), veha-agent (wss://) | #1 |

### Tier 2: Operational Necessities

Required for operating a fleet with confidence.

| # | Feature | Crates Affected | Depends On |
|---|---------|----------------|------------|
| 6 | **Agent watchdog for player process** | veha-agent | — |
| 7 | **Proof-of-play logging** | veha-player, veha-agent, veha-api | #3 |
| 8 | **Fleet health dashboard** (live status via WebSocket) | veha-api (static/), ws.rs | — |
| 9 | **Content integrity verification** (SHA256 checksums) | veha-api, veha-agent | #2 |
| 10 | **Audit logging** (who changed what) | veha-api | #1 |

### Tier 3: Scale & Polish

For growing beyond initial deployment.

| # | Feature | Crates Affected | Depends On |
|---|---------|----------------|------------|
| 11 | **OTA agent/player update mechanism** | veha-agent (new), veha-api | #1 |
| 12 | **PostgreSQL support** (as alternative to SQLite) | veha-api | — |
| 13 | **S3-compatible media storage** | veha-api | — |
| 14 | **Multi-tenant API** | veha-api | #1, #12 |
| 15 | **Hardware acceleration** (VA-API/NVDEC) | veha-core | — |
| 16 | **Content preview in dashboard** (use veha-web) | veha-web, veha-api (static/) | — |

### Tier 4: Differentiation

Features that create competitive distance.

| # | Feature | Description |
|---|---------|-------------|
| 17 | **Offline-first agent** | Agent operates fully autonomously with cached schedules + media |
| 18 | **Layout engine** | Split screen: multiple media zones per display |
| 19 | **Template system** | Dynamic content (weather, time, RSS) overlaid on media |
| 20 | **Sensor hooks** | Agent accepts external data (USB serial, GPIO, HTTP) to trigger content |
| 21 | **Android agent** | Extend agent to run on Android-based smart TVs/displays |

---

## 8. Technical Risks & Mitigations

### Risk 1: FFmpeg API Stability

**Risk:** The `ffmpeg-next` crate is pinned to v8, matching FFmpeg 8.x. FFmpeg does not guarantee API stability across major versions. A system FFmpeg upgrade could break the build.

**Mitigation:**
- Pin exact FFmpeg version in deployment (package manager hold or static linking)
- FFmpeg 7/8 API changes have been minor; wrap version-sensitive calls behind conditional compilation
- Consider static FFmpeg linking for release builds (`ffmpeg-next` supports this) to decouple from system libraries

### Risk 2: Single API Server as SPOF

**Risk:** All agents connect to one API server. If it goes down, no commands can be sent, no status is received.

**Mitigation:**
- Agents already auto-reconnect. A server restart causes temporary disconnect but no data loss.
- For critical deployments: move to active-passive with SQLite WAL mode, or migrate to PostgreSQL with replication (Phase 2).
- Agent offline-first capability (Tier 4, #17) makes boards fully autonomous during server outage.

### Risk 3: Framebuffer Deprecation on Linux

**Risk:** The Linux framebuffer (`/dev/fb0`) is considered legacy. Modern kernels prefer DRM/KMS.

**Mitigation:**
- Framebuffer support remains in mainline Linux kernels and is unlikely to be removed in the near term, especially on embedded/ARM boards.
- Add a DRM/KMS output backend as a future-proof alternative. The `OutputSink` trait makes this a drop-in addition.
- Many LED controller boards (Linsn, Novastar) provide their own framebuffer-compatible interfaces.

### Risk 4: WebSocket Scalability

**Risk:** Each board holds one persistent WebSocket connection. At 10,000 boards, that's 10,000 concurrent connections on a single server process.

**Mitigation:**
- Tokio + axum handle 10K+ concurrent WebSocket connections comfortably on modern hardware.
- Beyond that: introduce WebSocket gateway layer (e.g., multiple axum instances behind HAProxy with sticky sessions).
- The protocol is lightweight (JSON status every 10s, occasional commands). Bandwidth is negligible per connection.

### Risk 5: Media Storage at Scale

**Risk:** Media files are stored on the API server's local filesystem. Disk space becomes a constraint; no redundancy.

**Mitigation:**
- Phase 2 moves to S3-compatible storage.
- Intermediate step: NFS/network mount for shared storage across API instances.
- Content deduplication via SHA256 hashing prevents storing duplicate files.

---

## 9. Summary

### What veha is today

A functional, well-architected Rust media player with a distributed fleet management system. The core playback pipeline (FFmpeg → RGB24 → framebuffer) is solid. The agent-server orchestration works. The web dashboard, CLI, and WASM preview provide three distinct user interfaces. The codebase is clean, tested, and modular.

### What veha needs to become

A production-hardened platform with authentication, caching, schedule enforcement, and error recovery — the "Phase 1" work that turns a functional prototype into a deployable product. These are engineering problems with known solutions; the architecture already supports them.

### Why veha matters

The digital signage market is dominated by two extremes: cheap, unreliable solutions (USB sticks and consumer media players) and expensive enterprise platforms (Scala, four-wall). veha targets the middle: a self-hosted, high-performance, fleet-managed platform that runs on commodity hardware. The Rust foundation gives it a performance and reliability advantage that's difficult to replicate in the Node/Python/Java ecosystem. The framebuffer-native rendering is a genuine differentiation — no other open-source solution does this.

The moat is operational simplicity: `veha-player` + `veha-agent` on a minimal Linux image, pointed at a central API server. That's the entire board-side deployment. Everything else — media, playlists, schedules, commands — flows over a single WebSocket connection.

---

*This document reflects the state of the koompi-veha codebase as of commit `49629fc` on the `main` branch.*
