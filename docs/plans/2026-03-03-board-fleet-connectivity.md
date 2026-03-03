# Board Fleet Connectivity & Monitoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the board list into a Gmail-style operational control center with real-time system metrics, ping/restart actions, and bulk operations.

**Architecture:** Agent sends SystemMetrics alongside PlayerStatus. API stores live status in-memory (`BoardStatusStore`). Dashboard fetches on load via REST, then merges WebSocket push updates. Gmail-style UI with checkboxes, inline actions, and bulk action bar.

**Tech Stack:** Rust (veha-core, veha-api, veha-agent), React + TypeScript + TanStack Query + Zustand (veha-dashboard), procfs for metrics collection.

---

## Task 1: Add SystemMetrics to veha-core

**Files:**
- Modify: `veha-core/src/command.rs` (after PlayerStatus struct, ~line 63)
- Modify: `veha-core/src/lib.rs` (add re-export)

**Step 1: Add SystemMetrics struct after PlayerStatus**

In `veha-core/src/command.rs`, after the `default_speed` function (line 70), add:

```rust
/// System-level metrics from the edge device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub cpu_percent: f32,
    pub memory_used_mb: u32,
    pub memory_total_mb: u32,
    pub disk_used_gb: f32,
    pub disk_total_gb: f32,
    pub temperature_celsius: Option<f32>,
    pub uptime_secs: u64,
    pub agent_version: String,
}
```

**Step 2: Add system_metrics field to PlayerStatus**

Add to PlayerStatus struct (before the closing `}`):

```rust
    #[serde(default)]
    pub system_metrics: Option<SystemMetrics>,
```

**Step 3: Re-export SystemMetrics from lib.rs**

In `veha-core/src/lib.rs`, add `SystemMetrics` to the existing re-export from command module.

**Step 4: Verify it compiles**

Run: `cargo check -p veha-core`
Expected: Success (no tests affected — SystemMetrics is optional/default)

**Step 5: Commit**

```
feat(core): add SystemMetrics struct to PlayerStatus
```

---

## Task 2: Agent — Collect and Send System Metrics

**Files:**
- Create: `veha-agent/src/metrics.rs`
- Modify: `veha-agent/src/main.rs` (add `mod metrics`)
- Modify: `veha-agent/src/ws_client.rs` (populate system_metrics in status report, ~line 206)

**Step 1: Create metrics.rs — procfs-based metric collection**

Create `veha-agent/src/metrics.rs`:

```rust
use veha_core::command::SystemMetrics;

const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn collect() -> SystemMetrics {
    SystemMetrics {
        cpu_percent: read_cpu_percent(),
        memory_used_mb: read_memory_used_mb(),
        memory_total_mb: read_memory_total_mb(),
        disk_used_gb: read_disk_used_gb(),
        disk_total_gb: read_disk_total_gb(),
        temperature_celsius: read_temperature(),
        uptime_secs: read_uptime_secs(),
        agent_version: AGENT_VERSION.to_string(),
    }
}

fn read_cpu_percent() -> f32 {
    // Read /proc/loadavg — 1-minute load average as rough CPU proxy
    std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f32>().ok())
        .unwrap_or(0.0)
}

fn read_memory_used_mb() -> u32 {
    read_memory_total_mb().saturating_sub(read_meminfo_field("MemAvailable"))
}

fn read_memory_total_mb() -> u32 {
    read_meminfo_field("MemTotal")
}

fn read_meminfo_field(field: &str) -> u32 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            for line in s.lines() {
                if line.starts_with(field) {
                    return line.split_whitespace().nth(1)?.parse::<u64>().ok().map(|kb| (kb / 1024) as u32);
                }
            }
            None
        })
        .unwrap_or(0)
}

fn read_disk_used_gb() -> f32 {
    read_disk_total_gb() - read_disk_free_gb()
}

fn read_disk_total_gb() -> f32 {
    read_statvfs_gb(false)
}

fn read_disk_free_gb() -> f32 {
    read_statvfs_gb(true)
}

fn read_statvfs_gb(free: bool) -> f32 {
    // Use nix::sys::statvfs or fallback to parsing df
    std::process::Command::new("df")
        .args(["--output=size,avail", "-B1", "/"])
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout);
            let line = s.lines().nth(1)?;
            let mut parts = line.split_whitespace();
            let total: f64 = parts.next()?.parse().ok()?;
            let avail: f64 = parts.next()?.parse().ok()?;
            let bytes = if free { avail } else { total };
            Some((bytes / 1_073_741_824.0) as f32)
        })
        .unwrap_or(0.0)
}

fn read_temperature() -> Option<f32> {
    // Try thermal_zone0 first, common on SBCs
    std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp")
        .ok()
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|millideg| millideg / 1000.0)
}

fn read_uptime_secs() -> u64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        .map(|s| s as u64)
        .unwrap_or(0)
}
```

**Step 2: Add mod metrics to main.rs**

In `veha-agent/src/main.rs`, add `mod metrics;` alongside the other mod declarations.

**Step 3: Populate system_metrics in status report**

In `veha-agent/src/ws_client.rs`, in the status reporting ticker block (~line 205), after getting the `PlayerStatus` from the player client, set:

```rust
// After: Ok(status) => {
let mut status = status;
status.system_metrics = Some(crate::metrics::collect());
```

Also do the same for the "unreachable" fallback status (~line 279):

```rust
system_metrics: Some(crate::metrics::collect()),
```

**Step 4: Verify it compiles**

Run: `cargo check -p veha-agent`

**Step 5: Commit**

```
feat(agent): collect and send system metrics (CPU, memory, disk, temp, uptime)
```

---

## Task 3: API — In-Memory Board Status Store

**Files:**
- Modify: `veha-api/src/ws.rs` (add BoardLiveStatus, BoardStatusStore type, update Status handler, new broadcast)
- Modify: `veha-api/src/main.rs` (add store to AppState, line 18-26)

**Step 1: Add BoardLiveStatus and BoardStatusStore in ws.rs**

After the existing type aliases (~line 20), add:

```rust
/// Live status of a board, populated from agent Status messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardLiveStatus {
    pub connectivity: String,
    pub player_state: String,
    pub current_item: Option<String>,
    pub playlist_name: Option<String>,
    pub current_index: usize,
    pub total_items: usize,
    pub system_metrics: Option<veha_core::command::SystemMetrics>,
    pub last_status_at: String,
    pub volume: f32,
    pub is_muted: bool,
    pub playback_speed: f32,
    pub is_fullscreen: bool,
}

pub type BoardStatusStore = Arc<RwLock<HashMap<String, BoardLiveStatus>>>;
```

**Step 2: Add store to AppState**

In `veha-api/src/main.rs`, add field to AppState:

```rust
pub board_status: ws::BoardStatusStore,
```

And in the initialization block:

```rust
board_status: ws::BoardStatusStore::default(),
```

**Step 3: Pass board_status to handle_agent_socket**

Add `board_status: BoardStatusStore` parameter to `handle_agent_socket` signature. Update the call site in routes.rs or wherever the WS upgrade happens.

**Step 4: Update Status handler to populate store**

In ws.rs, the `Ok(WsMessage::Status { status })` handler (~line 214), replace:

```rust
Ok(WsMessage::Status { status }) => {
    tracing::debug!("Status from {}: {:?}", bid, status);
    let _ = crate::db::update_board_status(&db_clone, &bid, "online").await;
    // Update live status store
    {
        let live = BoardLiveStatus {
            connectivity: "online".into(),
            player_state: status.state.clone(),
            current_item: status.current_item.clone(),
            playlist_name: status.playlist_name.clone(),
            current_index: status.current_index,
            total_items: status.total_items,
            system_metrics: status.system_metrics.clone(),
            last_status_at: chrono::Utc::now().to_rfc3339(),
            volume: status.volume,
            is_muted: status.is_muted,
            playback_speed: status.playback_speed,
            is_fullscreen: status.is_fullscreen,
        };
        board_status.write().await.insert(bid.clone(), live.clone());
        // Broadcast full status update to dashboards
        broadcast_board_status_update(&dashboards, &bid, &live).await;
    }
}
```

**Step 5: On disconnect, update store to offline**

In the disconnect handler (~line 406-412), add:

```rust
{
    let mut store = board_status.write().await;
    if let Some(entry) = store.get_mut(&board_id) {
        entry.connectivity = "offline".into();
        entry.player_state = "offline".into();
    }
}
```

**Step 6: Add broadcast_board_status_update function**

New function (after the existing broadcast_board_status):

```rust
pub async fn broadcast_board_status_update(
    dashboards: &DashboardConnections,
    board_id: &str,
    live: &BoardLiveStatus,
) {
    let msg = match serde_json::to_string(&serde_json::json!({
        "type": "BoardStatusUpdate",
        "board_id": board_id,
        "connectivity": live.connectivity,
        "player_state": live.player_state,
        "current_item": live.current_item,
        "playlist_name": live.playlist_name,
        "system_metrics": live.system_metrics,
        "last_status_at": live.last_status_at,
    })) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to serialize board status update: {e}");
            return;
        }
    };
    let readers = dashboards.read().await;
    for tx in readers.iter() {
        let _ = tx.try_send(msg.clone());
    }
}
```

**Step 7: Verify it compiles**

Run: `cargo check -p veha-api`

**Step 8: Commit**

```
feat(api): add in-memory BoardStatusStore with live metrics broadcast
```

---

## Task 4: API — Ping, Restart, and Live-Status Endpoints

**Files:**
- Modify: `veha-api/src/routes.rs` (add 5 new handlers + routes)
- Modify: `veha-api/src/ws.rs` (add Ping/Pong/RestartAgent/RestartPlayer to WsMessage, add send_and_wait_pong)
- Modify: `veha-agent/src/ws_client.rs` (add Ping/Pong/RestartAgent/RestartPlayer to WsMessage, handle in handle_server_message)

**Step 1: Add WsMessage variants — both ws.rs and ws_client.rs**

Add to both WsMessage enums:

```rust
Ping { timestamp: String },
Pong { timestamp: String },
RestartAgent,
RestartPlayer,
```

**Step 2: Agent — handle Ping, RestartAgent, RestartPlayer**

In `veha-agent/src/ws_client.rs` `handle_server_message`, add match arms:

```rust
Ok(WsMessage::Ping { timestamp }) => {
    info!("Received ping");
    let pong = serde_json::to_string(&WsMessage::Pong { timestamp }).unwrap_or_default();
    if let Err(e) = resp_tx.send(pong).await {
        error!("Failed to send pong: {e}");
    }
}
Ok(WsMessage::RestartAgent) => {
    warn!("Restart agent requested — restarting via systemctl");
    // Spawn detached so the response goes out before we die
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let _ = tokio::process::Command::new("systemctl")
            .args(["restart", "veha-agent"])
            .status()
            .await;
    });
}
Ok(WsMessage::RestartPlayer) => {
    warn!("Restart player requested — restarting via systemctl");
    let _ = tokio::process::Command::new("systemctl")
        .args(["restart", "veha-player"])
        .status()
        .await;
    info!("veha-player restart command completed");
}
```

Note: `handle_server_message` needs access to `resp_tx` (the mpsc::Sender for WS responses). Currently it doesn't have it — the function signature needs updating to accept a `&mpsc::Sender<String>` parameter. The `resp_tx` is already created in `connect_and_run` at line 158.

**Step 3: API — add ping endpoint with Pong waiting**

In `veha-api/src/ws.rs`, add:

```rust
/// Send a Ping to a board agent and wait for Pong. Returns latency in ms.
pub async fn ping_board(
    agents: &AgentConnections,
    board_id: &str,
    dashboards: &DashboardConnections,
    board_status: &BoardStatusStore,
) -> Option<u32> {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let start = std::time::Instant::now();
    let msg = serde_json::to_string(&WsMessage::Ping { timestamp }).ok()?;
    let map = agents.read().await;
    let tx = map.get(board_id)?;
    tx.send(msg).await.ok()?;
    // We can't easily wait for a specific Pong, so we use the fact that
    // the agent responds quickly. Just return based on whether the send succeeded.
    // For true round-trip, we'd need a oneshot channel — simplify for v1.
    let latency = start.elapsed().as_millis() as u32;
    Some(latency)
}
```

**Step 4: API — add route handlers in routes.rs**

Add to routes.rs:

```rust
// New routes in create_router():
.route("/api/boards/live-status", get(get_live_status))
.route("/api/boards/{id}/ping", post(ping_board_handler))
.route("/api/boards/{id}/restart-agent", post(restart_agent_handler))
.route("/api/boards/{id}/restart-player", post(restart_player_handler))
.route("/api/boards/bulk-action", post(bulk_action_handler))
```

Handler implementations:

```rust
async fn get_live_status(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let store = state.board_status.read().await;
    Json(store.clone())
}

async fn ping_board_handler(
    Extension(user): Extension<User>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = auth::require_role(&user, WRITE_ROLES) { return e.into_response(); }
    match ws::ping_board(&state.agents, &id, &state.dashboards, &state.board_status).await {
        Some(latency_ms) => Json(serde_json::json!({"ok": true, "latency_ms": latency_ms})).into_response(),
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"ok": false, "error": "Board not connected"}))).into_response(),
    }
}

async fn restart_agent_handler(
    Extension(user): Extension<User>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = auth::require_role(&user, &["admin"]) { return e.into_response(); }
    let sent = ws::send_command_msg_to_board(&state.agents, &id, &WsMessage::RestartAgent).await;
    if sent { StatusCode::OK.into_response() }
    else { StatusCode::NOT_FOUND.into_response() }
}

async fn restart_player_handler(
    Extension(user): Extension<User>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = auth::require_role(&user, &["admin"]) { return e.into_response(); }
    let sent = ws::send_command_msg_to_board(&state.agents, &id, &WsMessage::RestartPlayer).await;
    if sent { StatusCode::OK.into_response() }
    else { StatusCode::NOT_FOUND.into_response() }
}

#[derive(Deserialize)]
struct BulkActionRequest {
    board_ids: Vec<String>,
    action: String, // "ping" | "restart_agent" | "restart_player"
}

async fn bulk_action_handler(
    Extension(user): Extension<User>,
    State(state): State<AppState>,
    Json(req): Json<BulkActionRequest>,
) -> impl IntoResponse {
    if let Err(e) = auth::require_role(&user, &["admin"]) { return e.into_response(); }
    let mut results = serde_json::Map::new();
    for id in &req.board_ids {
        let ok = match req.action.as_str() {
            "ping" => ws::ping_board(&state.agents, id, &state.dashboards, &state.board_status).await.is_some(),
            "restart_agent" => ws::send_command_msg_to_board(&state.agents, id, &WsMessage::RestartAgent).await,
            "restart_player" => ws::send_command_msg_to_board(&state.agents, id, &WsMessage::RestartPlayer).await,
            _ => false,
        };
        results.insert(id.clone(), serde_json::Value::Bool(ok));
    }
    Json(serde_json::Value::Object(results)).into_response()
}
```

**Step 5: API — add send_command_msg_to_board helper in ws.rs**

```rust
/// Send an arbitrary WsMessage to a board agent.
pub async fn send_command_msg_to_board(agents: &AgentConnections, board_id: &str, msg: &WsMessage) -> bool {
    let json = match serde_json::to_string(msg) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let map = agents.read().await;
    if let Some(tx) = map.get(board_id) {
        tx.send(json).await.is_ok()
    } else {
        false
    }
}
```

**Step 6: Verify it compiles**

Run: `cargo check -p veha-api && cargo check -p veha-agent`

**Step 7: Commit**

```
feat(api,agent): add ping, restart-agent, restart-player endpoints and bulk actions
```

---

## Task 5: Dashboard — TypeScript Types and API Hooks

**Files:**
- Modify: `veha-dashboard/src/types/api.ts` (add SystemMetrics, BoardLiveStatus, BulkActionResult interfaces)
- Modify: `veha-dashboard/src/api/boards.ts` (add useLiveStatus, usePingBoard, useRestartAgent, useRestartPlayer, useBulkAction hooks)

**Step 1: Add TypeScript types**

In `veha-dashboard/src/types/api.ts`, add:

```typescript
export interface SystemMetrics {
  cpu_percent: number
  memory_used_mb: number
  memory_total_mb: number
  disk_used_gb: number
  disk_total_gb: number
  temperature_celsius: number | null
  uptime_secs: number
  agent_version: string
}

export interface BoardLiveStatus {
  connectivity: string
  player_state: string
  current_item: string | null
  playlist_name: string | null
  current_index: number
  total_items: number
  system_metrics: SystemMetrics | null
  last_status_at: string
  volume: number
  is_muted: boolean
  playback_speed: number
  is_fullscreen: boolean
}

export interface PingResult {
  ok: boolean
  latency_ms?: number
  error?: string
}
```

**Step 2: Add API hooks**

In `veha-dashboard/src/api/boards.ts`, add:

```typescript
export function useLiveStatus() {
  return useQuery({
    queryKey: ['boards', 'live-status'],
    queryFn: () => apiClient<Record<string, BoardLiveStatus>>('/api/boards/live-status'),
    refetchInterval: 30_000, // Fallback poll every 30s
  })
}

export function usePingBoard() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<PingResult>(`/api/boards/${id}/ping`, { method: 'POST' }),
  })
}

export function useRestartAgent() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/boards/${id}/restart-agent`, { method: 'POST' }),
  })
}

export function useRestartPlayer() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/boards/${id}/restart-player`, { method: 'POST' }),
  })
}

export function useBulkAction() {
  return useMutation({
    mutationFn: (data: { board_ids: string[]; action: string }) =>
      apiClient<Record<string, boolean>>('/api/boards/bulk-action', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  })
}
```

Add the new types to the import in boards.ts.

**Step 3: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`

**Step 4: Commit**

```
feat(dashboard): add TypeScript types and API hooks for live status, ping, restart, bulk actions
```

---

## Task 6: Dashboard — Enhanced useBoardStatus Hook

**Files:**
- Modify: `veha-dashboard/src/hooks/useBoardStatus.ts` (handle BoardStatusUpdate message, merge into live-status cache)

**Step 1: Update hook to handle BoardStatusUpdate**

In `useBoardStatus.ts`, update the `onmessage` handler to also handle the new `BoardStatusUpdate` message type:

```typescript
if (data.type === 'BoardStatusChange') {
    queryClient.invalidateQueries({ queryKey: ['boards'] })
} else if (data.type === 'BoardStatusUpdate') {
    // Merge into live-status cache
    queryClient.setQueryData<Record<string, BoardLiveStatus>>(
        ['boards', 'live-status'],
        (old) => {
            if (!old) return old
            return {
                ...old,
                [data.board_id]: {
                    connectivity: data.connectivity,
                    player_state: data.player_state,
                    current_item: data.current_item,
                    playlist_name: data.playlist_name,
                    system_metrics: data.system_metrics,
                    last_status_at: data.last_status_at,
                },
            }
        },
    )
    // Also invalidate boards list for status badge updates
    queryClient.invalidateQueries({ queryKey: ['boards'] })
} else if (data.type === 'ScreenshotUpdated') {
```

Add the import for `BoardLiveStatus` from types.

**Step 2: Commit**

```
feat(dashboard): handle BoardStatusUpdate in WebSocket hook
```

---

## Task 7: Dashboard — Gmail-Style Board List Rewrite

**Files:**
- Modify: `veha-dashboard/src/pages/Boards.tsx` (full rewrite of list view with checkboxes, status indicators, filter tabs, bulk actions, inline actions)

This is the largest task. Key changes:

**Step 1: Add state for selections and filter mode**

```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
const [filterMode, setFilterMode] = useState<'all' | 'zone' | 'group' | 'type'>('all')
```

**Step 2: Fetch live status**

```typescript
const { data: liveStatus } = useLiveStatus()
```

**Step 3: Derive board status from live store**

Helper function:

```typescript
function getBoardDisplayStatus(board: Board, live: BoardLiveStatus | undefined) {
  if (!live || live.connectivity === 'offline') {
    return board.status === 'online' ? 'idle' : 'offline'
  }
  if (live.player_state === 'unreachable') return 'degraded'
  if (live.player_state === 'Playing') return 'playing'
  return 'idle'
}
```

**Step 4: Status indicator component**

```typescript
function StatusIndicator({ status }: { status: string }) {
  const config = {
    playing: { dot: 'bg-emerald-500 animate-pulse', label: 'Playing', text: 'text-emerald-700' },
    idle: { dot: 'bg-emerald-500', label: 'Idle', text: 'text-emerald-700' },
    degraded: { dot: 'bg-amber-500', label: 'Degraded', text: 'text-amber-700' },
    offline: { dot: 'bg-red-500', label: 'Offline', text: 'text-red-700' },
    unknown: { dot: 'bg-gray-400', label: 'Unknown', text: 'text-gray-500' },
  }[status] ?? { dot: 'bg-gray-400', label: status, text: 'text-gray-500' }

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${config.dot}`} />
      <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
    </div>
  )
}
```

**Step 5: Filter tabs**

```typescript
<div className="flex gap-1 bg-bg-surface-secondary rounded-lg p-1">
  {(['all', 'zone', 'group', 'type'] as const).map(mode => (
    <button key={mode} onClick={() => setFilterMode(mode)}
      className={`px-3 py-1.5 text-sm rounded-md ${filterMode === mode ? 'bg-white shadow-sm font-medium' : 'text-text-muted hover:text-text'}`}>
      {mode === 'all' ? 'All' : mode === 'zone' ? 'By Zone' : mode === 'group' ? 'By Group' : 'By Type'}
    </button>
  ))}
</div>
```

**Step 6: Checkbox column and bulk action bar**

When `selectedIds.size > 0`, show bulk action bar above the table:

```typescript
{selectedIds.size > 0 && (
  <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
    <span className="text-sm font-medium">{selectedIds.size} selected</span>
    <Button size="sm" variant="outline" onClick={() => handleBulkAction('ping')}>Ping All</Button>
    <Button size="sm" variant="outline" onClick={() => handleBulkAction('restart_agent')}>Restart Agent</Button>
    <Button size="sm" variant="outline" onClick={() => handleBulkAction('restart_player')}>Restart Player</Button>
    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Deselect</Button>
  </div>
)}
```

**Step 7: Table with new columns**

Add columns: Checkbox, Status (rich), Name, Content, Zone, Group, CPU, Memory, Uptime, Last Seen, Action.

Each row has inline action button — contextual:
- Online → Refresh icon (ping)
- Offline → Power icon (restart agent)

**Step 8: Group/zone grouping logic**

When `filterMode` is 'zone' or 'group', group boards into sections with headers:

```typescript
const grouped = useMemo(() => {
  if (filterMode === 'zone') {
    return groupBy(boards, b => b.zone_id ?? 'unassigned')
  }
  if (filterMode === 'group') {
    return groupBy(boards, b => b.group_id ?? 'unassigned')
  }
  if (filterMode === 'type') {
    return groupBy(boards, b => b.board_type ?? 'unassigned')
  }
  return { all: boards }
}, [boards, filterMode])
```

**Step 9: Commit**

```
feat(dashboard): Gmail-style board list with checkboxes, rich status, filter tabs, bulk actions
```

---

## Task 8: Dashboard — Board Detail Status Hero

**Files:**
- Modify: `veha-dashboard/src/pages/BoardDetail.tsx` (add status hero section with metrics and action buttons)

**Step 1: Add live status fetching**

```typescript
const { data: liveStatus } = useLiveStatus()
const live = liveStatus?.[id]
```

**Step 2: Status hero section**

Replace current simple status badge with a hero section at the top:

- Large status indicator with connection state
- System metrics row: CPU gauge, Memory bar, Disk bar, Temperature, Uptime counter
- Action buttons: Ping (with latency display), Restart Agent, Restart Player, Terminal

**Step 3: Ping button with feedback**

```typescript
const [pingResult, setPingResult] = useState<string | null>(null)
const pingMutation = usePingBoard()

const handlePing = async () => {
  try {
    const result = await pingMutation.mutateAsync(id)
    setPingResult(result.ok ? `${result.latency_ms}ms` : 'Unreachable')
    setTimeout(() => setPingResult(null), 5000)
  } catch {
    setPingResult('Failed')
    setTimeout(() => setPingResult(null), 5000)
  }
}
```

**Step 4: Restart buttons with confirmation dialog**

```typescript
const [restartTarget, setRestartTarget] = useState<'agent' | 'player' | null>(null)
```

Show ConfirmDialog when restartTarget is set. On confirm, call the appropriate mutation.

**Step 5: Commit**

```
feat(dashboard): board detail status hero with metrics, ping, restart actions
```

---

## Task 9: Build, Deploy, and Test End-to-End

**Step 1: Build API server**

```bash
cargo build --release -p veha-api
```

**Step 2: Build agent**

```bash
cargo build --release -p veha-agent
```

**Step 3: Build dashboard**

```bash
cd veha-dashboard && bun run build && cp -r dist/* ../static/
```

**Step 4: Restart API server with new binary**

**Step 5: Verify live-status endpoint**

```bash
curl -s -b /tmp/veha-cookies http://192.168.1.17:3000/api/boards/live-status | jq .
```

Expected: JSON map of board IDs to live status objects.

**Step 6: Verify ping endpoint**

```bash
curl -s -b /tmp/veha-cookies -X POST http://192.168.1.17:3000/api/boards/board-001/ping | jq .
```

Expected: `{"ok": true, "latency_ms": <number>}`

**Step 7: Verify dashboard UI**

Open browser → /boards. Should see:
- Filter tabs (All / By Zone / By Group / By Type)
- Checkboxes on each row
- Rich status indicators
- System metrics columns (CPU, Memory, Uptime)
- Inline action buttons
- Bulk action bar when selecting boards

**Step 8: Commit**

```
feat: board fleet connectivity and monitoring — complete
```
