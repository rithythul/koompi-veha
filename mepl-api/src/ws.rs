use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};

use mepl_core::command::{PlayerCommand, PlayerStatus};

/// Map of board_id -> sender channel for pushing messages to the agent.
pub type AgentConnections = Arc<RwLock<HashMap<String, mpsc::Sender<String>>>>;

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
}

/// Handle an incoming agent WebSocket connection.
pub async fn handle_agent_socket(
    socket: WebSocket,
    agents: AgentConnections,
    db: sqlx::SqlitePool,
    api_key: String,
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
                    // Update the board's status in the database.
                    let state_str = &status.state;
                    let _ =
                        crate::db::update_board_status(&db_clone, &bid, state_str).await;
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

    send_task.abort();
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
