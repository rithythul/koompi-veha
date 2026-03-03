# Board Fleet Connectivity & Monitoring — Design

## Goal

Transform the dashboard from a read-only board list into an operational control center where admins can see real-time board health, ping devices, restart agents, and manage boards in bulk — Gmail-style.

## Decisions

- **Approach**: In-memory status store on API server (Approach A). Fresh data, no SQLite write pressure, agents re-report on reconnect.
- **Status granularity**: Full operational — connection + player state + system metrics (CPU, memory, disk, temp, uptime).
- **List layout**: Single Boards page with filter tabs (All | By Zone | By Group | By Type).
- **Action UX**: Gmail-style — inline action per row + checkbox multi-select for bulk operations.
- **Metrics source**: Extend agent status report (periodic push, no on-demand).
- **Connect/reconnect**: Both ping (health check) and restart (agent service restart).

## 1. Agent: System Metrics Extension

Add `SystemMetrics` struct to the agent's periodic status report.

**veha-agent side**: Collect CPU%, memory, disk, temperature, uptime every report cycle (default 10s). Send alongside `PlayerStatus` in a new `StatusFull` message variant (or extend `Status` to include optional `system_metrics` field).

```rust
// New struct in veha-core/src/command.rs (shared)
pub struct SystemMetrics {
    pub cpu_percent: f32,
    pub memory_used_mb: u32,
    pub memory_total_mb: u32,
    pub disk_used_gb: f32,
    pub disk_total_gb: f32,
    pub temperature_celsius: Option<f32>,  // /sys/class/thermal, may not exist
    pub uptime_secs: u64,
    pub agent_version: String,
}
```

**Collection method**: Read `/proc/stat` (CPU), `/proc/meminfo` (memory), `statvfs` (disk), `/sys/class/thermal/thermal_zone0/temp` (temp), `/proc/uptime` (uptime). All procfs — no external dependencies.

**WsMessage change**: Add `system_metrics: Option<SystemMetrics>` to the existing `Status` variant. Optional so old agents still work.

## 2. API: In-Memory Board Status Store

New shared state: `BoardStatusStore = Arc<RwLock<HashMap<String, BoardLiveStatus>>>`.

```rust
pub struct BoardLiveStatus {
    pub connectivity: String,           // "online" | "offline"
    pub player_state: String,           // "Playing" | "Paused" | "Idle" | "unreachable"
    pub current_item: Option<String>,
    pub playlist_name: Option<String>,
    pub current_index: usize,
    pub total_items: usize,
    pub system_metrics: Option<SystemMetrics>,
    pub last_status_at: chrono::DateTime<chrono::Utc>,
    pub volume: f32,
    pub is_muted: bool,
    pub playback_speed: f32,
    pub is_fullscreen: bool,
}
```

**Populated by**: Agent `Status` messages in `handle_agent_socket`. On disconnect → set connectivity = "offline".

### New REST Endpoints

- `GET /api/boards/live-status` — Returns `HashMap<board_id, BoardLiveStatus>` for all boards. Dashboard polls this on page load, then uses WS for updates.
- `POST /api/boards/{id}/ping` — Sends Ping to agent, waits for Pong (with timeout), returns `{ ok: bool, latency_ms: u32 }`.
- `POST /api/boards/{id}/restart-agent` — Sends `RestartAgent` command to agent. Agent runs `systemctl restart veha-agent`. Returns immediately (fire-and-forget).
- `POST /api/boards/{id}/restart-player` — Sends `RestartPlayer` command. Agent runs `systemctl restart veha-player`.
- `POST /api/boards/bulk-action` — `{ board_ids: [...], action: "ping" | "restart_agent" | "restart_player" }`. Returns per-board results.

### New WsMessage Variants (both ws.rs and ws_client.rs)

```rust
Ping { timestamp: String }           // API → Agent
Pong { timestamp: String }           // Agent → API
RestartAgent,                        // API → Agent (agent restarts itself)
RestartPlayer,                       // API → Agent (agent restarts player service)
```

### Enhanced Dashboard Broadcast

Replace simple `BoardStatusChange` with richer `BoardStatusUpdate`:

```json
{
  "type": "BoardStatusUpdate",
  "board_id": "board-001",
  "connectivity": "online",
  "player_state": "Playing",
  "current_item": "KOOMPI-Ad-Video.mp4",
  "system_metrics": { "cpu_percent": 23.5, "memory_used_mb": 412, ... },
  "last_status_at": "2026-03-03T01:00:00Z"
}
```

Backward-compatible: dashboard handles both old `BoardStatusChange` and new `BoardStatusUpdate`.

## 3. Agent: Ping/Restart Handling

In `handle_server_message`:

- **Ping**: Reply with `Pong { timestamp }` immediately.
- **RestartAgent**: Spawn detached `systemctl restart veha-agent` (agent will die and systemd restarts it).
- **RestartPlayer**: Run `systemctl restart veha-player`, wait, report result.

## 4. Dashboard: Gmail-Style Board List

### Filter Tabs

Top of page: `All` | `By Zone` | `By Group` | `By Type`

- **All**: Flat list, sorted by status (offline first, then playing, then idle).
- **By Zone**: Grouped sections with zone name headers, collapsible.
- **By Group**: Grouped sections with group name headers.
- **By Type**: Grouped by board_type (led_billboard, hdmi_display, etc.).

### Table Columns

| Column | Content |
|--------|---------|
| ☐ | Checkbox for multi-select |
| Status | Rich indicator (dot + label): green pulsing "Playing", green "Idle", yellow "Degraded", red "Offline", gray "Unknown" |
| Name | Board name, clickable → detail page |
| Content | Current playing item name (truncated) or "—" |
| Zone | Zone name |
| Group | Group name |
| CPU | % bar, color-coded (green < 60%, yellow < 85%, red ≥ 85%) |
| Memory | Used/Total MB |
| Uptime | Human-readable (e.g., "3d 4h") |
| Last Seen | Relative time |
| Action | Contextual icon button: refresh (ping) when online, power (restart) when offline |

### Bulk Action Bar

Appears when 1+ checkboxes selected. Shows: "X selected" + action buttons:
- **Ping All** — ping selected boards, show results
- **Restart Agent** — restart agent on selected boards
- **Restart Player** — restart player on selected boards
- **Deselect All**

### Card View

Same data in card format. Status color stripe on left edge (green/yellow/red/gray). Checkbox in top-left corner. Inline action button in top-right.

### Real-time Updates

- `useBoardStatus` hook enhanced to handle `BoardStatusUpdate` messages.
- On page load: fetch `GET /api/boards/live-status` for initial state.
- Live updates via WebSocket merge into local state (Zustand or TanStack Query cache).

## 5. Dashboard: Board Detail Enhancement

### Status Hero Section

Top of board detail page, replaces current simple status badge:

- Large status indicator with colored dot + state text + connection uptime
- System metrics row: CPU | Memory | Disk | Temp | Uptime (gauges or compact bars)
- Action buttons row: Ping | Restart Agent | Restart Player | Terminal

### Ping Feedback

When ping button clicked:
1. Button shows spinner
2. On success: "42ms" with green checkmark, fades after 3s
3. On failure: "Unreachable" with red X

### Restart Feedback

When restart clicked:
1. Confirmation dialog ("Restart agent on board-001?")
2. Button shows spinner
3. Board status transitions: Online → Offline → Reconnecting... → Online
4. Toast notification on completion

## 6. Status State Machine

```
                    ┌──────────┐
         ┌─────────│  Unknown  │ (never connected)
         │         └──────────┘
         │              │ Agent connects
         ▼              ▼
    ┌──────────┐   ┌──────────┐
    │ Offline  │◄──│  Online  │
    └──────────┘   └────┬─────┘
         │              │
         │    ┌─────────┼──────────┐
         │    ▼         ▼          ▼
         │ Playing    Idle     Degraded
         │ (player    (player  (agent ok,
         │  active)    idle)    player
         │                     unreachable)
         │
         └──── Ping/Restart actions available
```

**Status derivation**:
- `connectivity == "offline"` → Offline
- `connectivity == "online"` && `player_state == "Playing"` → Playing (green pulsing)
- `connectivity == "online"` && `player_state == "Idle"/"Paused"/"Stopped"` → Idle (green)
- `connectivity == "online"` && `player_state == "unreachable"` → Degraded (yellow)
- No status ever received → Unknown (gray)
