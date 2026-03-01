# Veha — Digital Billboard Management Platform

## What It Is

Veha is a complete software platform for managing LED billboard networks. It handles everything from uploading media to playing content on screens, with a web dashboard for operators and automated agents running on each billboard.

## Core Capabilities

**Fleet Management** — Register and monitor boards across locations. Organize by zones (geographic hierarchy) and groups. Track online/offline status in real time via WebSocket. Set operating hours, screen specs, and orientation per board.

**Media & Playlists** — Upload images and videos (up to 2GB). Build playlists with drag-and-drop timeline editing, per-item duration control, and live preview. Media plays via FFmpeg on the billboard hardware.

**Advertising Workflow** — Full campaign lifecycle: create advertisers, launch campaigns (draft/active/paused), attach creatives with an approval workflow, and book placements on specific boards, zones, or groups with date ranges, time windows, and day-of-week targeting.

**Smart Scheduling** — The system resolves what each board should play right now based on active bookings, priority, time of day, and sell mode. Supports exclusive (single-advertiser takeover) and rotation (multi-advertiser loop) booking types.

**Revenue & Pricing** — Set rates per slot at the zone level. Booking costs are auto-calculated. Revenue reports group earnings by advertiser, zone, or campaign over any date range.

**Proof of Play** — Every play is logged with board, booking, creative, timestamps, and duration. Campaign performance metrics include total plays, reach, cost-per-play, and budget utilization. Export logs to CSV.

**Monitoring & Alerts** — Boards going offline or campaigns expiring soon trigger automatic alerts. Dashboard shows unread alert count with one-click acknowledgment.

**Security** — Session-based auth with Argon2 password hashing. Three roles: admin, operator, viewer. API key support (SHA-256 hashed) for programmatic integrations via `X-API-Key` header.

## Architecture

```
  Dashboard (React SPA)  <——REST/WS——>  API Server (Rust/Axum + SQLite)
                                              |
                                         WebSocket
                                              |
                                     Board Agents (1 per screen)
                                              |
                                          IPC (Unix socket)
                                              |
                                     Player Daemon (FFmpeg)
                                              |
                                        LED / HDMI Output
```

- **API Server** — Rust, single binary, embedded SQLite, serves the dashboard and all APIs.
- **Agent** — Runs on each billboard. Maintains persistent WebSocket, receives schedule updates, reports play logs.
- **Player** — Local daemon decoding video/images via FFmpeg and outputting to framebuffer or display.

## Benefits

- **Single binary deployment** — no external databases, message queues, or cloud dependencies required.
- **Real-time fleet visibility** — live board status and instant command delivery.
- **End-to-end ad workflow** — from advertiser onboarding to proof-of-play reporting in one system.
- **Offline resilient** — agents auto-reconnect; players continue with last-known playlist.
- **Role-based access** — operators manage content, admins control users and API keys, viewers monitor.

## Current Limitations

- **SQLite** — single-server database; not designed for multi-region horizontal scaling.
- **No media transcoding** — files play as uploaded; no automatic format conversion.
- **No cloud storage** — media stored on local disk of the API server.
- **UTC only** — no timezone-aware scheduling.
- **Estimates, not billing** — revenue figures are calculated estimates, not integrated with payment systems.
- **No audit trail** — tracks who created resources but not full change history.

## Technical Requirements

- Linux server for API (Rust binary + SQLite)
- Linux device per billboard (agent + player + FFmpeg 8+)
- Modern browser for dashboard
