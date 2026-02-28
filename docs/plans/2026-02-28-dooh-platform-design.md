# DOOH Platform Design — koompi-mepl

**Date:** 2026-02-28
**Status:** Proposed
**Target Customer:** PPML (Cambodia) — 500-2000+ billboards

## 1. Problem Statement

koompi-mepl is currently a media player fleet management system. It can push playlists to boards and control playback remotely. However, it lacks the data model and workflows needed for a Digital Out-of-Home (DOOH) advertising business where:

- Different billboards show different ads from different advertisers
- Timeslots are sold per-board or per-zone to advertisers
- Some billboards show house (owned) content while others sell ad space
- Operators need proof-of-play records for billing
- The network spans 2000+ boards across geographic regions

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Business model | Hybrid (sell + house) | PPML sells ad space on some boards, shows own content on others |
| Timeslot model | Mixed (rotation + exclusive) | Some boards sell 15s rotation slots, others rent full time blocks |
| Dashboard access | Operator-only now, portal-ready schema | Avoids auth complexity now; no schema rework to add advertiser portal later |
| Location model | GPS + hierarchical zones | Enables both map views and inventory queries ("all boards in BKK1") |
| Scheduling unification | Unified campaign/booking model | "House advertiser" pattern eliminates dual scheduling paths |
| Schedule resolution | Server-side with agent caching | API generates resolved playlists; agents cache for offline resilience |

## 3. Security Review — Current State

### Critical Issues (must fix before PPML deployment)

**S1. No dashboard authentication.** All REST endpoints are publicly accessible. Anyone on the network can create/delete boards, upload media, and send commands to billboards. This is the single biggest security gap.

**S2. No HTTPS/TLS.** All traffic (including API keys, media, commands) travels in plaintext. WebSocket connections from 2000 agents carry credentials and control messages over the internet.

**S3. No authorization model.** Even with auth added, there's no concept of roles. Everyone with access can do everything.

### Important Issues

**S4. Single shared API key.** All 2000 agents share one key. A compromised agent reveals the key for the entire fleet. Per-board keys or certificate-based auth would be more robust, but the shared key is acceptable initially if combined with TLS.

**S5. No rate limiting.** API endpoints accept unlimited requests. A misbehaving agent or external actor could overwhelm the server.

**S6. Media files served without auth.** `/api/media/{id}/download` is publicly accessible. If advertiser creatives contain pre-release content, this is a data leak.

**S7. No input validation on commands.** `PlayerCommand` is deserialized from user input and forwarded to agents without schema validation beyond serde.

**S8. SQLite single-writer bottleneck.** At 2000 boards reporting play logs every few seconds, SQLite's single-writer lock will become a bottleneck. WAL mode helps but has limits.

### Addressed by Production Hardening (already done)

- Panic-free error handling across all crates
- Streaming uploads with 2GB limit
- Path traversal protection on downloads
- Graceful shutdown
- IPC timeouts and message size limits
- Database indexes on FK and sort columns
- API key auth for agents (single shared key)

### Security Roadmap

| Phase | Scope |
|-------|-------|
| Phase 1 (with DOOH launch) | S1: Session auth for dashboard, S2: TLS docs/config, S3: Admin/operator roles |
| Phase 2 (scale) | S5: Rate limiting, S6: Authed media downloads, S8: PostgreSQL migration path |
| Phase 3 (advertiser portal) | Per-advertiser auth, creative approval workflow, per-agent API keys |

## 4. Data Model

### 4.1 Entity Relationship Diagram

```
                       ┌──────────┐
                       │  zones   │ ◄── parent_id (self-ref)
                       └────┬─────┘
                            │ zone_id
                       ┌────▼─────┐       ┌──────────┐
                   ┌───│  boards  │───────►│  groups  │
                   │   └────┬─────┘       └──────────┘
                   │        │ board_id
                   │   ┌────▼──────────┐
                   │   │  play_logs    │
                   │   └───────────────┘
                   │
                   │   ┌──────────────┐     ┌────────────┐
                   │   │ advertisers  │────►│ campaigns   │
                   │   └──────────────┘     └─────┬──────┘
                   │                              │ campaign_id
                   │                        ┌─────▼──────┐     ┌───────┐
                   │                        │ creatives   │────►│ media │
                   │                        └────────────┘     └───────┘
                   │
                   │   ┌─────────────┐
                   └───│  bookings   │◄── campaign_id
                       └─────┬───────┘
                             │ booking_id
                       ┌─────▼───────┐
                       │ play_logs   │
                       └─────────────┘
```

### 4.2 New Tables

#### `zones` — Geographic hierarchy

```sql
CREATE TABLE IF NOT EXISTS zones (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    zone_type   TEXT NOT NULL DEFAULT 'custom',  -- 'country','city','district','custom'
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES zones(id) ON DELETE SET NULL
);
```

Zones form a tree: Cambodia > Phnom Penh > BKK1. Boards reference a zone. Bookings can target a zone (all boards in that zone and its children).

#### `boards` — Extended with location + DOOH fields

Extend the existing `boards` table with new columns:

```sql
ALTER TABLE boards ADD COLUMN zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN latitude REAL;
ALTER TABLE boards ADD COLUMN longitude REAL;
ALTER TABLE boards ADD COLUMN address TEXT;
ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'led_billboard';
ALTER TABLE boards ADD COLUMN screen_width INTEGER;
ALTER TABLE boards ADD COLUMN screen_height INTEGER;
ALTER TABLE boards ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE boards ADD COLUMN sell_mode TEXT NOT NULL DEFAULT 'house_only';
  -- 'rotation' | 'exclusive' | 'house_only'
ALTER TABLE boards ADD COLUMN operating_hours_start TEXT;  -- HH:MM
ALTER TABLE boards ADD COLUMN operating_hours_end TEXT;    -- HH:MM
```

The `group_id` column stays for operational grouping (separate from geographic zones). `sell_mode` determines how the board's timeslots work:
- `house_only` — plays house content via direct playlist/schedule assignment (current behavior)
- `rotation` — plays a loop of ads from bookings, each ad getting N seconds per loop
- `exclusive` — bookings get full ownership of the time window

#### `advertisers` — Companies buying ad space

```sql
CREATE TABLE IF NOT EXISTS advertisers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    is_house      INTEGER NOT NULL DEFAULT 0,  -- TRUE for PPML's own "house" account
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

A special "House" advertiser (is_house=1) is auto-created on first boot. This represents PPML's own content. Operators create campaigns under this advertiser for owned content.

#### `campaigns` — Time-bound ad projects

```sql
CREATE TABLE IF NOT EXISTS campaigns (
    id              TEXT PRIMARY KEY,
    advertiser_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
      -- 'draft','active','paused','completed','cancelled'
    start_date      TEXT NOT NULL,  -- YYYY-MM-DD
    end_date        TEXT NOT NULL,  -- YYYY-MM-DD
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (advertiser_id) REFERENCES advertisers(id) ON DELETE CASCADE
);
```

#### `creatives` — Campaign media assets

```sql
CREATE TABLE IF NOT EXISTS creatives (
    id              TEXT PRIMARY KEY,
    campaign_id     TEXT NOT NULL,
    media_id        TEXT NOT NULL,
    name            TEXT,
    duration_secs   INTEGER,  -- NULL = use media's natural duration
    status          TEXT NOT NULL DEFAULT 'approved',
      -- 'pending_review','approved','rejected' (for future advertiser portal)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT
);
```

Links campaigns to media files. `duration_secs` overrides how long to display (relevant for images in rotation playlists). `status` exists for future creative approval workflows.

#### `bookings` — Campaign placed on boards/zones

```sql
CREATE TABLE IF NOT EXISTS bookings (
    id                TEXT PRIMARY KEY,
    campaign_id       TEXT NOT NULL,
    booking_type      TEXT NOT NULL,         -- 'rotation' | 'exclusive'
    target_type       TEXT NOT NULL,         -- 'board' | 'zone' | 'group'
    target_id         TEXT NOT NULL,         -- references boards.id, zones.id, or groups.id
    start_date        TEXT NOT NULL,         -- YYYY-MM-DD
    end_date          TEXT NOT NULL,         -- YYYY-MM-DD
    start_time        TEXT,                  -- HH:MM (NULL = all day)
    end_time          TEXT,                  -- HH:MM (NULL = all day)
    days_of_week      TEXT DEFAULT '0,1,2,3,4,5,6',
    slot_duration_secs INTEGER DEFAULT 15,  -- for rotation: seconds per ad spot
    slots_per_loop    INTEGER DEFAULT 1,    -- for rotation: how many slots this booking gets
    priority          INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'confirmed',
      -- 'draft','confirmed','active','completed','cancelled'
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
```

Key fields:
- `booking_type`: rotation = N-second spot in a shared loop; exclusive = sole ownership of time window
- `target_type` + `target_id`: polymorphic reference. A booking can target a single board, all boards in a zone, or all boards in a group
- `slot_duration_secs`: how long each play of this ad lasts (default 15s for rotation)
- `slots_per_loop`: how many plays per loop this booking gets (e.g., 2 out of 8 = 25% share of voice)
- `priority`: higher number wins when bookings conflict

#### `play_logs` — Proof of play

```sql
CREATE TABLE IF NOT EXISTS play_logs (
    id            TEXT PRIMARY KEY,
    board_id      TEXT NOT NULL,
    booking_id    TEXT,             -- NULL for house/direct content
    creative_id   TEXT,             -- NULL for house/direct content
    media_id      TEXT,
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_secs INTEGER,
    status        TEXT NOT NULL DEFAULT 'played',  -- 'played','skipped','error'
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE SET NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
);
```

Agents report play events. Each row = "board X played creative Y from booking Z at time T for N seconds." This is the billing-grade proof-of-play record.

### 4.3 Existing Tables — Migration Strategy

| Table | Action |
|-------|--------|
| `groups` | Keep as-is. Groups = operational. Zones = geographic. Both coexist. |
| `boards` | Extend with new columns (ALTER TABLE). No breaking changes. |
| `media` | Keep as-is. Creatives reference media. |
| `playlists` | Keep as-is. Used for house_only boards and as resolved schedule output. |
| `schedules` | Deprecate over time. New bookings replace this. Keep working for backward compat during migration. |

## 5. Schedule Resolution Engine

The core business logic: given a board and a timestamp, what should play?

### 5.1 Resolution Algorithm

```
resolve_schedule(board, now) -> ResolvedPlaylist:

1. If board.sell_mode == 'house_only':
   - Use existing schedule/playlist system (unchanged behavior)
   - Return the playlist from the highest-priority matching schedule

2. Find all active bookings for this board:
   a. Direct: bookings where target_type='board' AND target_id=board.id
   b. Zone: bookings where target_type='zone' AND target_id IN (board's zone + ancestors)
   c. Group: bookings where target_type='group' AND target_id=board.group_id

3. Filter bookings by:
   - start_date <= today <= end_date
   - start_time <= current_time <= end_time (or NULL = all day)
   - current day_of_week in days_of_week
   - status = 'active' or 'confirmed'

4. Sort by priority (desc), then by created_at (asc, first-come-first-served)

5. Resolve by booking_type:
   a. If any EXCLUSIVE booking matches:
      - Take highest-priority exclusive booking
      - Build playlist from its campaign's approved creatives
      - Fill remaining time with next-priority bookings (if gaps exist)
   b. If only ROTATION bookings match:
      - Build rotation loop proportional to each booking's slots_per_loop
      - Each creative plays for slot_duration_secs
      - Loop indefinitely

6. Fill gaps with house content:
   - If time windows have no bookings, play house advertiser's content
   - Or fall back to board's schedule/playlist (existing system)

7. Return ResolvedPlaylist (list of MediaItems with durations)
```

### 5.2 Push vs Pull

The server resolves schedules and **pushes** resolved playlists to agents via WebSocket (`LoadPlaylist` command). Resolution triggers:

- When a booking is created/updated/deleted
- When a campaign status changes
- When creatives are added/removed
- On a periodic sweep (every 5 minutes) for time-window transitions
- When an agent reconnects

The agent caches the last resolved playlist in a local file. If the WebSocket connection drops, the agent continues playing the cached playlist until reconnection.

## 6. WebSocket Protocol Extensions

### 6.1 New Message Types

Add to `WsMessage` enum in both mepl-api and mepl-agent:

```rust
pub enum WsMessage {
    // Existing
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register { board_id: String, api_key: Option<String> },
    Ack { ok: bool },

    // New: server pushes resolved schedule to agent
    ScheduleUpdate {
        playlist: String,      // JSON-serialized playlist
        active_booking_ids: Vec<String>,  // for proof-of-play attribution
    },

    // New: agent reports play events
    PlayReport {
        booking_id: Option<String>,
        creative_id: Option<String>,
        media_id: Option<String>,
        started_at: String,
        ended_at: String,
        duration_secs: u32,
        status: String,  // "played", "skipped", "error"
    },
}
```

### 6.2 Extended PlayerStatus

```rust
pub struct PlayerStatus {
    pub state: String,
    pub current_item: Option<String>,
    pub current_index: usize,
    pub total_items: usize,
    pub playlist_name: Option<String>,
    // New fields
    pub active_booking_id: Option<String>,
    pub active_creative_id: Option<String>,
    pub uptime_secs: u64,
}
```

## 7. API Endpoints

### 7.1 New Endpoints

```
# Zones
GET    /api/zones                  List zones (hierarchical)
POST   /api/zones                  Create zone
GET    /api/zones/{id}             Get zone with child zones and board count
PUT    /api/zones/{id}             Update zone
DELETE /api/zones/{id}             Delete zone (reassigns boards to parent)

# Advertisers
GET    /api/advertisers            List advertisers (paginated)
POST   /api/advertisers            Create advertiser
GET    /api/advertisers/{id}       Get advertiser with campaign summary
PUT    /api/advertisers/{id}       Update advertiser
DELETE /api/advertisers/{id}       Delete advertiser (cascades campaigns)

# Campaigns
GET    /api/campaigns              List campaigns (paginated, filterable by advertiser/status)
POST   /api/campaigns              Create campaign
GET    /api/campaigns/{id}         Get campaign with creatives and bookings
PUT    /api/campaigns/{id}         Update campaign
DELETE /api/campaigns/{id}         Delete campaign
POST   /api/campaigns/{id}/activate   Set status to 'active'
POST   /api/campaigns/{id}/pause      Set status to 'paused'

# Creatives
GET    /api/campaigns/{id}/creatives    List creatives for campaign
POST   /api/campaigns/{id}/creatives    Add creative (link media to campaign)
DELETE /api/creatives/{id}              Remove creative

# Bookings
GET    /api/bookings               List bookings (paginated, filterable)
POST   /api/bookings               Create booking
GET    /api/bookings/{id}          Get booking detail
PUT    /api/bookings/{id}          Update booking
DELETE /api/bookings/{id}          Delete booking
GET    /api/bookings/{id}/play-logs  Play logs for this booking

# Play Logs
GET    /api/play-logs              List play logs (paginated, filterable by board/booking/date)
GET    /api/play-logs/summary      Aggregated play report (counts by board/campaign/date)

# Schedule Resolution (internal, used by dashboard for preview)
GET    /api/boards/{id}/resolved-schedule   Preview what a board would play right now

# Boards (extended)
PUT    /api/boards/{id}            Update board (location, zone, sell_mode, screen specs)
```

### 7.2 Existing Endpoint Changes

```
GET /api/boards     -> Add filters: ?zone_id=X&sell_mode=rotation&status=online
GET /api/media      -> Add filter: ?mime_type=image/*
```

Dashboard frontend `api()` calls need updating to handle the new paginated response format `{ data: [...], total, page, per_page }` for existing endpoints (this was added in Task 8 but the frontend still expects bare arrays).

## 8. Dashboard UX

### 8.1 Navigation Structure

```
Sidebar:
  [icon] Dashboard        (new: overview stats)
  [icon] Boards           (enhanced: location, zone, sell_mode)
  [icon] Zones            (new: geographic hierarchy)
  [icon] Advertisers      (new)
  [icon] Campaigns        (new: with creatives sub-view)
  [icon] Bookings         (new: timeslot management)
  [icon] Media            (existing, unchanged)
  [icon] Play Logs        (new: proof-of-play reports)
  [icon] Schedules        (existing, for legacy/house boards)
```

### 8.2 Key Screens

**Dashboard Overview:**
- Board count (online/offline/total)
- Active campaigns count
- Today's play count
- Revenue-relevant: plays by advertiser today

**Boards (enhanced):**
- Table with columns: Name, Zone, Status, Sell Mode, Resolution, Last Seen
- Click row: detail panel with location map (Leaflet.js), screen specs, active bookings
- Filter by zone, sell_mode, status
- Bulk actions: assign zone, change sell_mode

**Zones:**
- Tree view (expandable). Each node shows: name, type, board count
- CRUD inline
- Drag-drop to reorganize hierarchy (future)

**Advertisers:**
- Table: Name, Contact, Active Campaigns, Total Bookings
- Click: detail with campaign list

**Campaigns:**
- Table: Name, Advertiser, Status, Date Range, Creatives Count, Bookings Count
- Create flow: name, advertiser, dates -> add creatives (select from media library) -> create bookings
- Status badges: draft (gray), active (green), paused (yellow), completed (blue)

**Bookings (timeslot management):**
- Table: Campaign, Target, Type, Date Range, Time Window, Days, Priority, Status
- Create flow: select campaign -> select target (board/zone/group) -> configure time window, type (rotation/exclusive), slots
- Calendar view (future): visualize bookings across a board's timeline

**Play Logs:**
- Table: Board, Campaign, Creative, Time, Duration, Status
- Filters: date range, board, advertiser, campaign
- Export to CSV
- Summary view: plays per advertiser per day

## 9. Authentication Design (Phase 1)

### 9.1 Session-Based Auth

Add a `users` table:

```sql
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',  -- 'admin','operator','viewer'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Roles:
- **admin**: full access (user management, system config, all CRUD)
- **operator**: manage boards, media, campaigns, bookings. Cannot manage users.
- **viewer**: read-only access to all data + play logs. For reporting/auditing.

Auth flow:
- `POST /api/auth/login` — username + password -> returns session cookie (HttpOnly, Secure, SameSite=Strict)
- `POST /api/auth/logout` — invalidates session
- `GET /api/auth/me` — returns current user info
- Sessions stored in SQLite with expiry
- axum middleware extracts session from cookie, injects `CurrentUser` into handlers
- All API routes (except `/health` and `/api/auth/*`) require valid session
- Agent WebSocket auth remains API-key based (unchanged)

### 9.2 Password Hashing

Use `argon2` crate (current best practice for password hashing). On first boot, if no users exist, create a default admin user with a random password printed to stdout/logs.

### 9.3 TLS

The application itself does not terminate TLS. Deployment guide documents using a reverse proxy (Caddy recommended for automatic HTTPS):

```
caddy:
  mepl.ppml.com.kh {
    reverse_proxy localhost:3000
  }
```

## 10. Implementation Phases

### Phase 1: DOOH Core (priority)
1. Database migration (zones, advertisers, campaigns, creatives, bookings, play_logs, users)
2. Session authentication + roles
3. Advertiser CRUD endpoints
4. Campaign + creative CRUD endpoints
5. Booking CRUD endpoints
6. Schedule resolution engine
7. WebSocket protocol extensions (ScheduleUpdate, PlayReport)
8. Play log ingestion from agents
9. Dashboard: new pages (zones, advertisers, campaigns, bookings, play logs, overview)
10. Dashboard: fix paginated response handling for existing pages
11. Dashboard: enhanced boards page (location, zone, sell_mode)

### Phase 2: Production Scale
12. Rate limiting middleware
13. Authed media downloads
14. Play log reporting + CSV export
15. PostgreSQL migration support
16. Agent-side playlist caching for offline resilience

### Phase 3: Advertiser Portal
17. Per-advertiser auth tokens
18. Creative approval workflow
19. Self-service booking requests
20. Per-agent API keys

## 11. Backward Compatibility

- Existing agents continue to work unchanged until they're updated (Register + Status protocol is untouched)
- Existing `schedules` table stays functional for `house_only` boards
- Existing `playlists` table stays functional
- New DOOH features are additive — no existing endpoints change behavior
- Dashboard frontend handles both old (array) and new (paginated) response formats during transition
- `sell_mode` defaults to `house_only`, so existing boards behave exactly as before
