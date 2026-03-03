use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use base64::Engine;
use futures::{SinkExt, StreamExt};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};

use veha_core::command::{PlayerCommand, PlayerStatus};

/// Map of board_id -> sender channel for pushing messages to the agent.
pub type AgentConnections = Arc<RwLock<HashMap<String, mpsc::Sender<String>>>>;

/// Set of sender channels for connected dashboard WebSocket clients.
pub type DashboardConnections = Arc<RwLock<Vec<mpsc::Sender<String>>>>;

/// Map of terminal session_id -> sender channel for pushing output to the dashboard terminal WS.
pub type TerminalSessions = Arc<RwLock<HashMap<String, mpsc::Sender<String>>>>;

/// Maximum number of screenshot history entries to keep per board.
pub const MAX_SCREENSHOTS_PER_BOARD: usize = 60;

/// Per-screenshot metadata entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotEntry {
    pub timestamp_ms: u64,
    pub timestamp: String,
}

/// Ordered screenshot history for a single board (newest last).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BoardScreenshots {
    pub entries: Vec<ScreenshotEntry>,
}

/// Map of board_id -> screenshot history.
pub type ScreenshotStore = Arc<RwLock<HashMap<String, BoardScreenshots>>>;

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

/// Messages exchanged over the WebSocket.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register {
        board_id: String,
        #[serde(default)]
        api_key: Option<String>,
    },
    Ack { ok: bool },
    ScheduleUpdate {
        playlist: String,
        active_booking_ids: Vec<String>,
    },
    PlayReport {
        booking_id: Option<String>,
        creative_id: Option<String>,
        media_id: Option<String>,
        started_at: String,
        ended_at: String,
        duration_secs: u32,
        status: String,
    },
    Screenshot {
        board_id: String,
        timestamp: String,
        data: String,
    },
    // ── Remote Terminal ──
    TerminalStart {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    TerminalInput {
        session_id: String,
        data: String,
    },
    TerminalOutput {
        session_id: String,
        data: String,
    },
    TerminalResize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    TerminalExit {
        session_id: String,
        #[serde(default)]
        code: Option<i32>,
    },
    // ── Fleet Management ──
    Ping { timestamp: String },
    Pong { timestamp: String },
    RestartAgent,
    RestartPlayer,
}

/// Handle an incoming agent WebSocket connection.
pub async fn handle_agent_socket(
    socket: WebSocket,
    agents: AgentConnections,
    dashboards: DashboardConnections,
    db: sqlx::SqlitePool,
    api_key: String,
    screenshots: ScreenshotStore,
    media_dir: String,
    analysis_store: crate::screenshot_analysis::AnalysisStore,
    terminal_sessions: TerminalSessions,
    board_status: BoardStatusStore,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Wait for the first message to be a Register message.
    let board_id = match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<WsMessage>(&text) {
                Ok(WsMessage::Register { board_id, api_key: agent_key }) => {
                    // Validate API key if server has one configured
                    if !api_key.is_empty() {
                        let valid = agent_key
                            .as_deref()
                            .map(|k| k == api_key)
                            .unwrap_or(false);
                        if !valid {
                            tracing::warn!("Agent {} rejected: invalid API key", board_id);
                            let nak = serde_json::to_string(&WsMessage::Ack { ok: false })
                                .unwrap_or_default();
                            let _ = ws_tx.send(Message::Text(nak.into())).await;
                            return;
                        }
                    }
                    tracing::info!("Agent registered: {}", board_id);
                    // Send ack
                    let ack = match serde_json::to_string(&WsMessage::Ack { ok: true }) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!("Failed to serialize ack: {e}");
                            return;
                        }
                    };
                    if ws_tx.send(Message::Text(ack.into())).await.is_err() {
                        return;
                    }
                    board_id
                }
                _ => {
                    tracing::warn!("First message was not Register");
                    return;
                }
            }
        }
        _ => {
            tracing::warn!("WebSocket closed before registration");
            return;
        }
    };

    // Upsert the board in the database.
    if let Err(e) = crate::db::upsert_board(&db, &board_id).await {
        tracing::error!("Failed to upsert board {}: {}", board_id, e);
    }

    // Create a channel for sending commands to this agent.
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<String>(32);

    // Clone cmd_tx before moving into map
    let push_tx = cmd_tx.clone();

    // Store the sender in the shared map, cleaning up any old connection.
    {
        let mut map = agents.write().await;
        if let Some(old_tx) = map.insert(board_id.clone(), cmd_tx) {
            drop(old_tx);
            tracing::warn!("Replaced existing connection for board {}", board_id);
        }
    }

    let bid = board_id.clone();
    let agents_clone = agents.clone();
    let db_clone = db.clone();

    // Spawn a task that forwards commands from the channel to the WebSocket.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = cmd_rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Push resolved schedule to newly connected agent
    let push_db = db.clone();
    let push_bid = board_id.clone();
    tokio::spawn(async move {
        match crate::resolver::resolve_for_board(&push_db, &push_bid).await {
            Ok(resolved) => {
                if !resolved.items.is_empty() {
                    let playlist_json = serde_json::to_string(&resolved).unwrap_or_default();
                    let msg = serde_json::to_string(&WsMessage::ScheduleUpdate {
                        playlist: playlist_json,
                        active_booking_ids: resolved.active_booking_ids,
                    }).unwrap_or_default();
                    if push_tx.send(msg).await.is_err() {
                        tracing::warn!("Failed to push schedule to {push_bid}");
                    }
                }
            }
            Err(e) => tracing::error!("Failed to resolve schedule for {push_bid}: {e}"),
        }
    });

    // Read incoming messages from the agent (status updates).
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            match serde_json::from_str::<WsMessage>(&text) {
                Ok(WsMessage::Status { status }) => {
                    tracing::debug!("Status from {}: {:?}", bid, status);
                    let _ =
                        crate::db::update_board_status(&db_clone, &bid, "online").await;
                    // Update live status store
                    let live = BoardLiveStatus {
                        connectivity: "online".into(),
                        player_state: status.state.clone(),
                        current_item: status.current_item.clone(),
                        playlist_name: status.playlist_name.clone(),
                        current_index: status.current_index,
                        total_items: status.total_items,
                        system_metrics: status.system_metrics.clone(),
                        last_status_at: Utc::now().to_rfc3339(),
                        volume: status.volume,
                        is_muted: status.is_muted,
                        playback_speed: status.playback_speed,
                        is_fullscreen: status.is_fullscreen,
                    };
                    board_status.write().await.insert(bid.clone(), live.clone());
                    broadcast_board_status_update(&dashboards, &bid, &live).await;
                }
                Ok(WsMessage::PlayReport {
                    booking_id, creative_id, media_id,
                    started_at, ended_at, duration_secs, status,
                }) => {
                    tracing::debug!("Play report from {}: booking={:?}", bid, booking_id);
                    if let Err(e) = crate::db::insert_play_log(
                        &db_clone,
                        &bid,
                        booking_id.as_deref(),
                        creative_id.as_deref(),
                        media_id.as_deref(),
                        &started_at,
                        Some(&ended_at),
                        Some(duration_secs as i32),
                        &status,
                    ).await {
                        tracing::error!("Failed to insert play log from {}: {e}", bid);
                    }
                }
                Ok(WsMessage::Screenshot { board_id: _, timestamp: _, data }) => {
                    tracing::debug!("Screenshot from {}", bid);
                    match base64::engine::general_purpose::STANDARD.decode(&data) {
                        Ok(jpeg_bytes) => {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default();
                            let timestamp_ms = now.as_millis() as u64;
                            let timestamp = Utc::now().to_rfc3339();

                            // Create per-board directory
                            let board_dir = std::path::Path::new(&media_dir)
                                .join("screenshots")
                                .join(&bid);
                            if let Err(e) = tokio::fs::create_dir_all(&board_dir).await {
                                tracing::error!("Failed to create screenshot dir for {bid}: {e}");
                                continue;
                            }

                            // Save timestamped file
                            let ts_path = board_dir.join(format!("{timestamp_ms}.jpg"));
                            if let Err(e) = tokio::fs::write(&ts_path, &jpeg_bytes).await {
                                tracing::error!("Failed to save screenshot for {bid}: {e}");
                                continue;
                            }

                            // Backward-compat: also write screenshots/{bid}.jpg
                            let compat_path = std::path::Path::new(&media_dir)
                                .join("screenshots")
                                .join(format!("{bid}.jpg"));
                            let _ = tokio::fs::write(&compat_path, &jpeg_bytes).await;

                            // Update screenshot store
                            let entry = ScreenshotEntry {
                                timestamp_ms,
                                timestamp: timestamp.clone(),
                            };
                            let mut store = screenshots.write().await;
                            let board_shots = store.entry(bid.clone()).or_default();
                            board_shots.entries.push(entry);

                            // Prune oldest entries beyond max
                            while board_shots.entries.len() > MAX_SCREENSHOTS_PER_BOARD {
                                let old = board_shots.entries.remove(0);
                                let old_path = board_dir.join(format!("{}.jpg", old.timestamp_ms));
                                let _ = tokio::fs::remove_file(&old_path).await;
                            }
                            drop(store);

                            // Broadcast to dashboard clients
                            let update = serde_json::json!({
                                "type": "ScreenshotUpdated",
                                "board_id": bid,
                                "timestamp": timestamp,
                                "timestamp_ms": timestamp_ms,
                            });
                            if let Ok(msg) = serde_json::to_string(&update) {
                                let readers = dashboards.read().await;
                                for tx in readers.iter() {
                                    let _ = tx.try_send(msg.clone());
                                }
                            }
                            tracing::debug!("Screenshot saved for {bid} ({timestamp_ms})");

                            // Spawn analysis in background
                            let analysis_store_c = analysis_store.clone();
                            let dashboards_c = dashboards.clone();
                            let db_c = db_clone.clone();
                            let bid_c = bid.clone();
                            let jpeg_for_analysis = jpeg_bytes.clone();
                            tokio::spawn(async move {
                                // Get previous hash
                                let prev_hash = {
                                    let store = analysis_store_c.read().await;
                                    store.get(&bid_c).and_then(|s| s.prev_hash)
                                };

                                let thresholds = crate::screenshot_analysis::AnomalyThresholds::default();
                                let result = tokio::task::spawn_blocking(move || {
                                    crate::screenshot_analysis::analyze_screenshot(
                                        &jpeg_for_analysis,
                                        prev_hash,
                                        &thresholds,
                                    )
                                })
                                .await;

                                if let Ok(Some(analysis)) = result {
                                    // Update analysis store with new hash
                                    {
                                        let mut store = analysis_store_c.write().await;
                                        let state = store.entry(bid_c.clone()).or_default();
                                        state.prev_hash = Some(analysis.pixel_hash);
                                    }

                                    // Create alerts for anomalies
                                    let mut alert_created = false;

                                    if analysis.is_black {
                                        if let Ok(true) = crate::db::create_screenshot_alert(
                                            &db_c, &bid_c, "screen_black",
                                            &format!("Board {} appears to show a black screen", bid_c),
                                        ).await {
                                            alert_created = true;
                                            tracing::warn!("Black screen detected on {bid_c}");
                                        }
                                    } else if analysis.is_solid {
                                        // Skip solid alert if already black (no double-alert)
                                        if let Ok(true) = crate::db::create_screenshot_alert(
                                            &db_c, &bid_c, "screen_solid",
                                            &format!("Board {} appears to show a solid color", bid_c),
                                        ).await {
                                            alert_created = true;
                                            tracing::warn!("Solid color detected on {bid_c}");
                                        }
                                    }

                                    if analysis.is_frozen {
                                        if let Ok(true) = crate::db::create_screenshot_alert(
                                            &db_c, &bid_c, "screen_frozen",
                                            &format!("Board {} appears to have a frozen screen", bid_c),
                                        ).await {
                                            alert_created = true;
                                            tracing::warn!("Frozen screen detected on {bid_c}");
                                        }
                                    }

                                    if alert_created {
                                        // Broadcast AlertCreated to dashboards
                                        let msg = serde_json::json!({
                                            "type": "AlertCreated",
                                            "board_id": bid_c,
                                        });
                                        if let Ok(msg_str) = serde_json::to_string(&msg) {
                                            let readers = dashboards_c.read().await;
                                            for tx in readers.iter() {
                                                let _ = tx.try_send(msg_str.clone());
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Failed to decode screenshot base64 from {bid}: {e}");
                        }
                    }
                }
                Ok(WsMessage::TerminalOutput { ref session_id, .. })
                | Ok(WsMessage::TerminalExit { ref session_id, .. }) => {
                    // Forward terminal output/exit from agent to the dashboard terminal WS
                    let sessions = terminal_sessions.read().await;
                    if let Some(tx) = sessions.get(session_id) {
                        let _ = tx.try_send(text.to_string());
                    }
                }
                _ => {
                    tracing::debug!("Received message from {}: {}", bid, text);
                }
            }
        }
    }

    // Agent disconnected — clean up.
    tracing::info!("Agent disconnected: {}", board_id);
    {
        let mut map = agents_clone.write().await;
        map.remove(&board_id);
    }
    let _ = crate::db::update_board_status(&db, &board_id, "offline").await;
    broadcast_board_status(&dashboards, &board_id, "offline").await;
    // Update live status store
    {
        let mut store = board_status.write().await;
        if let Some(entry) = store.get_mut(&board_id) {
            entry.connectivity = "offline".into();
            entry.player_state = "offline".into();
        }
    }

    send_task.abort();
}

/// Resolve and push the current schedule to a specific board agent.
/// No-op if the board is not connected.
pub async fn push_schedule_to_board(
    agents: &AgentConnections,
    db: &sqlx::SqlitePool,
    board_id: &str,
) {
    // Check if board is connected before doing work
    let is_connected = agents.read().await.contains_key(board_id);
    if !is_connected {
        return;
    }

    match crate::resolver::resolve_for_board(db, board_id).await {
        Ok(resolved) => {
            let playlist_json = serde_json::to_string(&resolved).unwrap_or_default();
            let msg = match serde_json::to_string(&WsMessage::ScheduleUpdate {
                active_booking_ids: resolved.active_booking_ids,
                playlist: playlist_json,
            }) {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!("Failed to serialize schedule for {board_id}: {e}");
                    return;
                }
            };
            let map = agents.read().await;
            if let Some(tx) = map.get(board_id) {
                if tx.send(msg).await.is_err() {
                    tracing::warn!("Failed to push schedule to {board_id}");
                }
            }
        }
        Err(e) => tracing::error!("Failed to resolve schedule for {board_id}: {e}"),
    }
}

/// Push updated schedules to all given board IDs (in background).
pub fn push_schedule_to_boards(
    agents: AgentConnections,
    db: sqlx::SqlitePool,
    board_ids: Vec<String>,
) {
    tokio::spawn(async move {
        for board_id in &board_ids {
            push_schedule_to_board(&agents, &db, board_id).await;
        }
    });
}

/// Send a command to a specific board agent. Returns true if the message was queued.
pub async fn send_command_to_board(
    agents: &AgentConnections,
    board_id: &str,
    command: &PlayerCommand,
) -> bool {
    let msg = match serde_json::to_string(&WsMessage::Command {
        command: command.clone(),
    }) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to serialize command: {e}");
            return false;
        }
    };

    let map = agents.read().await;
    if let Some(tx) = map.get(board_id) {
        tx.send(msg).await.is_ok()
    } else {
        false
    }
}

/// Broadcast a board status change to all connected dashboard clients.
pub async fn broadcast_board_status(
    dashboards: &DashboardConnections,
    board_id: &str,
    status: &str,
) {
    let msg = match serde_json::to_string(&serde_json::json!({
        "type": "BoardStatusChange",
        "board_id": board_id,
        "status": status,
    })) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to serialize board status broadcast: {e}");
            return;
        }
    };

    let readers = dashboards.read().await;
    for tx in readers.iter() {
        let _ = tx.try_send(msg.clone());
    }
}

/// Broadcast a rich board status update to all connected dashboard clients.
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
        "volume": live.volume,
        "is_muted": live.is_muted,
        "current_index": live.current_index,
        "total_items": live.total_items,
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

/// Send an arbitrary WsMessage to a board agent. Returns true if queued.
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

/// Send a Ping to a board agent. Returns estimated latency if agent is connected.
pub async fn ping_board(agents: &AgentConnections, board_id: &str) -> Option<u32> {
    let timestamp = Utc::now().to_rfc3339();
    let start = std::time::Instant::now();
    let msg = serde_json::to_string(&WsMessage::Ping { timestamp }).ok()?;
    let map = agents.read().await;
    let tx = map.get(board_id)?;
    tx.send(msg).await.ok()?;
    let latency = start.elapsed().as_millis() as u32;
    Some(latency)
}

/// Handle an incoming dashboard WebSocket connection.
pub async fn handle_dashboard_socket(socket: WebSocket, dashboards: DashboardConnections) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Create a channel for sending messages to this dashboard client.
    let (tx, mut rx) = mpsc::channel::<String>(64);

    // Register this dashboard connection.
    {
        let mut conns = dashboards.write().await;
        conns.push(tx);
    }

    // Spawn a task that forwards messages from the channel to the WebSocket.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Keep the connection alive by reading (and discarding) incoming messages.
    // Dashboard clients don't send meaningful messages, but we need to consume
    // the stream to detect disconnection and handle ping/pong.
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Close(_) => break,
            _ => {} // Ignore other messages from dashboards
        }
    }

    // Dashboard disconnected — clean up by removing the sender.
    // We remove any sender whose receiver has been dropped (closed).
    {
        let mut conns = dashboards.write().await;
        conns.retain(|tx| !tx.is_closed());
    }

    send_task.abort();
    tracing::debug!("Dashboard WebSocket disconnected");
}

/// Handle a terminal WebSocket connection from a dashboard client.
///
/// This creates a session, sends TerminalStart to the agent, and bridges
/// I/O between the dashboard WebSocket and the agent.
pub async fn handle_terminal_socket(
    socket: WebSocket,
    board_id: String,
    agents: AgentConnections,
    terminal_sessions: TerminalSessions,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Generate a unique session ID
    let session_id = uuid::Uuid::new_v4().to_string();
    tracing::info!("Terminal session {session_id} starting for board {board_id}");

    // Create a channel for receiving output from the agent
    let (output_tx, mut output_rx) = mpsc::channel::<String>(128);

    // Register the terminal session
    {
        let mut sessions = terminal_sessions.write().await;
        sessions.insert(session_id.clone(), output_tx);
    }

    // Send TerminalStart to the agent with default size (will be resized by client)
    let start_msg = serde_json::to_string(&WsMessage::TerminalStart {
        session_id: session_id.clone(),
        cols: 80,
        rows: 24,
    })
    .unwrap_or_default();

    let agent_connected = {
        let map = agents.read().await;
        if let Some(tx) = map.get(&board_id) {
            tx.send(start_msg).await.is_ok()
        } else {
            false
        }
    };

    if !agent_connected {
        tracing::warn!("Board {board_id} not connected, cannot start terminal");
        let err = serde_json::json!({
            "type": "TerminalExit",
            "session_id": session_id,
            "code": -1,
            "error": "Board is not connected"
        });
        let _ = ws_tx
            .send(Message::Text(
                serde_json::to_string(&err).unwrap_or_default().into(),
            ))
            .await;
        // Clean up
        terminal_sessions.write().await.remove(&session_id);
        return;
    }

    // Send session_id to the client so it knows which session this is
    let init_msg = serde_json::json!({
        "type": "TerminalReady",
        "session_id": session_id,
    });
    if ws_tx
        .send(Message::Text(
            serde_json::to_string(&init_msg).unwrap_or_default().into(),
        ))
        .await
        .is_err()
    {
        terminal_sessions.write().await.remove(&session_id);
        return;
    }

    let sid = session_id.clone();
    let agents_clone = agents.clone();
    let board_id_clone = board_id.clone();

    // Forward agent output to the dashboard WS
    let send_task = tokio::spawn(async move {
        while let Some(msg) = output_rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Read input from the dashboard WS and forward to agent
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                // Parse the message and forward to agent
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = parsed.get("type").and_then(|t| t.as_str());
                    let forward = match msg_type {
                        Some("TerminalInput") => {
                            // Inject the session_id
                            let fwd = serde_json::to_string(&WsMessage::TerminalInput {
                                session_id: sid.clone(),
                                data: parsed
                                    .get("data")
                                    .and_then(|d| d.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            });
                            fwd.ok()
                        }
                        Some("TerminalResize") => {
                            let cols = parsed
                                .get("cols")
                                .and_then(|c| c.as_u64())
                                .unwrap_or(80) as u16;
                            let rows = parsed
                                .get("rows")
                                .and_then(|r| r.as_u64())
                                .unwrap_or(24) as u16;
                            let fwd = serde_json::to_string(&WsMessage::TerminalResize {
                                session_id: sid.clone(),
                                cols,
                                rows,
                            });
                            fwd.ok()
                        }
                        _ => None,
                    };

                    if let Some(fwd_msg) = forward {
                        let map = agents_clone.read().await;
                        if let Some(tx) = map.get(&board_id_clone) {
                            let _ = tx.send(fwd_msg).await;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Clean up: send TerminalExit to agent and remove session
    tracing::info!("Terminal session {session_id} ended for board {board_id}");
    let exit_msg =
        serde_json::to_string(&WsMessage::TerminalExit {
            session_id: session_id.clone(),
            code: None,
        })
        .unwrap_or_default();
    {
        let map = agents.read().await;
        if let Some(tx) = map.get(&board_id) {
            let _ = tx.send(exit_msg).await;
        }
    }

    terminal_sessions.write().await.remove(&session_id);
    send_task.abort();
}
