use base64::Engine;
use chrono::Utc;
use futures::{SinkExt, StreamExt};
use veha_core::command::{PlayerCommand, PlayerStatus};
use serde::{Deserialize, Serialize};
use tokio::time::{self, Duration, Instant};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::config::AgentConfig;
use crate::player_client;
use crate::terminal;

/// Messages exchanged over the WebSocket (duplicated from veha-api since we
/// cannot depend on that crate).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register {
        board_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    Ack { ok: bool },
    ScheduleUpdate {
        playlist: String,
        #[serde(default)]
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

/// Run the WebSocket client loop with automatic reconnection.
///
/// This function never returns under normal operation -- it reconnects
/// with exponential backoff whenever the connection drops.
pub async fn run(config: AgentConfig) {
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF: u64 = 60;

    loop {
        info!("Connecting to API server at {}", config.api_url);

        match connect_and_run(&config).await {
            Ok(()) => {
                info!("WebSocket session ended cleanly");
                // Reset backoff on clean session (connection was successful)
                backoff_secs = 1;
            }
            Err(e) => {
                error!("WebSocket error: {e}");
            }
        }

        info!("Reconnecting in {backoff_secs}s ...");
        time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
    }
}

/// Connect to the API server, register, and process messages until the
/// connection closes or an error occurs.
async fn connect_and_run(config: &AgentConfig) -> Result<(), Box<dyn std::error::Error>> {
    let (ws_stream, _response) = tokio_tungstenite::connect_async(&config.api_url).await?;
    info!("WebSocket connected");

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // --- Register ---
    let register_msg = serde_json::to_string(&WsMessage::Register {
        board_id: config.board_id.clone(),
        api_key: if config.api_key.is_empty() {
            None
        } else {
            Some(config.api_key.clone())
        },
    })?;
    ws_tx.send(Message::Text(register_msg.into())).await?;
    debug!("Sent Register for board_id={}", config.board_id);

    // Wait for Ack
    match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => match serde_json::from_str::<WsMessage>(&text) {
            Ok(WsMessage::Ack { ok: true }) => {
                info!("Registered successfully as {}", config.board_id);
            }
            Ok(WsMessage::Ack { ok: false }) => {
                error!("Registration rejected by server");
                return Err("Registration rejected".into());
            }
            other => {
                warn!("Unexpected response to Register: {other:?}");
                return Err("Unexpected registration response".into());
            }
        },
        Some(Ok(msg)) => {
            warn!("Unexpected message type during registration: {msg:?}");
            return Err("Unexpected message during registration".into());
        }
        Some(Err(e)) => return Err(e.into()),
        None => return Err("Connection closed before registration ack".into()),
    }

    // --- Main loop: listen for commands & send periodic status ---
    let socket_path = config.player_socket.clone();
    let api_base_url = config.api_base_url();
    let report_interval = Duration::from_secs(config.report_interval_secs);
    let mut status_ticker = time::interval(report_interval);

    let screenshot_interval_secs = config.screenshot_interval_secs;
    let screenshot_enabled = screenshot_interval_secs > 0;
    let mut screenshot_ticker = time::interval(Duration::from_secs(
        if screenshot_enabled { screenshot_interval_secs } else { 3600 },
    ));
    let screenshot_path = format!("/tmp/veha-screenshot-{}.jpg", config.board_id);
    let screenshot_board_id = config.board_id.clone();

    // Channel for terminal output and other async responses to be sent over WS
    let (resp_tx, mut resp_rx) = tokio::sync::mpsc::channel::<String>(64);
    let mut terminal_mgr = terminal::TerminalManager::new(resp_tx.clone());

    // Play log tracking: detect when the player transitions between items.
    let mut prev_item: Option<String> = None; // source of previous item
    let mut prev_index: usize = 0;
    let mut prev_booking_id: Option<String> = None;
    let mut prev_creative_id: Option<String> = None;
    let mut prev_media_id: Option<String> = None;
    let mut item_started_at: Option<Instant> = None;
    let mut item_started_at_utc: Option<String> = None;

    loop {
        tokio::select! {
            // Incoming message from the API server
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_message(&text, &socket_path, &api_base_url, &mut terminal_mgr, &resp_tx).await;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        ws_tx.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("Server closed connection");
                        break;
                    }
                    Some(Err(e)) => {
                        error!("WebSocket read error: {e}");
                        break;
                    }
                    _ => {}
                }
            }

            // Async responses (terminal output, etc.) to send back
            resp = resp_rx.recv() => {
                if let Some(msg) = resp {
                    if let Err(e) = ws_tx.send(Message::Text(msg.into())).await {
                        error!("Failed to send response: {e}");
                        break;
                    }
                }
            }

            // Periodic status report
            _ = status_ticker.tick() => {
                match player_client::get_status(&socket_path).await {
                    Ok(mut status) => {
                        status.system_metrics = Some(crate::metrics::collect());
                        // Detect item transition and send play report for the previous item.
                        let current_item = status.current_item.clone();
                        let current_index = status.current_index;
                        let is_playing = status.state == "Playing";

                        let item_changed = is_playing
                            && prev_item.is_some()
                            && (current_item != prev_item || current_index != prev_index);

                        // Also report if the player stopped/paused after playing something.
                        let playback_ended = !is_playing
                            && prev_item.is_some()
                            && item_started_at.is_some();

                        if item_changed || playback_ended {
                            if let (Some(started_at), Some(started_utc)) =
                                (item_started_at.take(), item_started_at_utc.take())
                            {
                                let duration = started_at.elapsed();
                                let now_utc = Utc::now().to_rfc3339();
                                let report = WsMessage::PlayReport {
                                    booking_id: prev_booking_id.take(),
                                    creative_id: prev_creative_id.take(),
                                    media_id: prev_media_id.take(),
                                    started_at: started_utc,
                                    ended_at: now_utc,
                                    duration_secs: duration.as_secs() as u32,
                                    status: if playback_ended {
                                        "completed".into()
                                    } else {
                                        "played".into()
                                    },
                                };
                                if let Ok(report_json) = serde_json::to_string(&report) {
                                    if let Err(e) = ws_tx.send(Message::Text(report_json.into())).await {
                                        error!("Failed to send play report: {e}");
                                        break;
                                    }
                                    debug!("Sent play report for previous item");
                                }
                            }
                        }

                        // Track current item for next comparison.
                        if is_playing && current_item.is_some() {
                            if item_started_at.is_none() || item_changed {
                                // New item started playing.
                                item_started_at = Some(Instant::now());
                                item_started_at_utc = Some(Utc::now().to_rfc3339());
                                prev_booking_id = status.active_booking_id.clone();
                                prev_creative_id = status.active_creative_id.clone();
                                prev_media_id = status.active_media_id.clone();
                            }
                        } else {
                            item_started_at = None;
                            item_started_at_utc = None;
                        }
                        prev_item = current_item;
                        prev_index = current_index;

                        // Send the status report.
                        let msg = serde_json::to_string(&WsMessage::Status { status })?;
                        if let Err(e) = ws_tx.send(Message::Text(msg.into())).await {
                            error!("Failed to send status: {e}");
                            break;
                        }
                        debug!("Sent status report");
                    }
                    Err(e) => {
                        warn!("Could not get player status: {e}");
                        // Send an offline-ish status so the server knows
                        // the player might not be running.
                        let status = PlayerStatus {
                            state: "unreachable".into(),
                            current_item: None,
                            current_index: 0,
                            total_items: 0,
                            playlist_name: None,
                            active_booking_id: None,
                            active_creative_id: None,
                            active_media_id: None,
                            uptime_secs: None,
                            position_secs: None,
                            duration_secs: None,
                            volume: 1.0,
                            is_muted: false,
                            playback_speed: 1.0,
                            is_fullscreen: false,
                            system_metrics: Some(crate::metrics::collect()),
                        };
                        let msg = serde_json::to_string(&WsMessage::Status { status })?;
                        let _ = ws_tx.send(Message::Text(msg.into())).await;
                    }
                }
            }

            // Periodic screenshot capture
            _ = screenshot_ticker.tick(), if screenshot_enabled => {
                debug!("Taking periodic screenshot");
                let cmd = PlayerCommand::TakeScreenshot(screenshot_path.clone());
                match player_client::send_command(&socket_path, &cmd).await {
                    Ok(_) => {
                        // Give the player a moment to write the file
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        // Read the JPEG file and send as base64
                        match tokio::fs::read(&screenshot_path).await {
                            Ok(jpeg_data) => {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_data);
                                let msg = WsMessage::Screenshot {
                                    board_id: screenshot_board_id.clone(),
                                    timestamp: Utc::now().to_rfc3339(),
                                    data: b64,
                                };
                                if let Ok(json) = serde_json::to_string(&msg) {
                                    if let Err(e) = ws_tx.send(Message::Text(json.into())).await {
                                        error!("Failed to send screenshot: {e}");
                                        break;
                                    }
                                    debug!("Sent screenshot for {}", screenshot_board_id);
                                }
                            }
                            Err(e) => {
                                warn!("Could not read screenshot file: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to request screenshot from player: {e}");
                    }
                }
            }
        }
    }

    // Clean up all terminal sessions on disconnect
    terminal_mgr.kill_all();

    Ok(())
}

/// Transform a ResolvedPlaylist JSON string (with `board_id`) into a Playlist
/// JSON string (with `name`), and convert relative media URLs to absolute.
fn transform_playlist(raw: &str, api_base_url: &str) -> Result<String, serde_json::Error> {
    let mut v: serde_json::Value = serde_json::from_str(raw)?;
    if let Some(obj) = v.as_object_mut() {
        // Rename board_id → name (Playlist expects `name`, ResolvedPlaylist sends `board_id`)
        if let Some(board_id) = obj.remove("board_id") {
            obj.entry("name").or_insert(board_id);
        }
        // Convert relative source URLs to absolute
        if let Some(items) = obj.get_mut("items").and_then(|i| i.as_array_mut()) {
            for item in items {
                if let Some(source) = item.get_mut("source").and_then(|s| s.as_str().map(String::from)) {
                    if source.starts_with('/') {
                        item["source"] = serde_json::Value::String(format!("{api_base_url}{source}"));
                    }
                }
            }
        }
    }
    serde_json::to_string(&v)
}

/// Handle a text message received from the API server.
async fn handle_server_message(
    text: &str,
    socket_path: &str,
    api_base_url: &str,
    terminal_mgr: &mut terminal::TerminalManager,
    resp_tx: &tokio::sync::mpsc::Sender<String>,
) {
    match serde_json::from_str::<WsMessage>(text) {
        Ok(WsMessage::Command { command }) => {
            info!("Received command: {command:?}");
            match player_client::send_command(socket_path, &command).await {
                Ok(resp) => debug!("Player response: {resp}"),
                Err(e) => error!("Failed to forward command to player: {e}"),
            }
        }
        Ok(WsMessage::ScheduleUpdate { playlist, active_booking_ids }) => {
            info!("Received schedule update with {} active bookings", active_booking_ids.len());
            // Transform: rename board_id→name, make URLs absolute
            let playlist_json = match transform_playlist(&playlist, api_base_url) {
                Ok(p) => p,
                Err(e) => {
                    error!("Failed to transform playlist: {e}");
                    return;
                }
            };
            let command = PlayerCommand::LoadPlaylist(playlist_json);
            // Retry a few times in case the player socket isn't ready yet
            for attempt in 0..5 {
                match player_client::send_command(socket_path, &command).await {
                    Ok(resp) => {
                        debug!("Player loaded schedule: {resp}");
                        break;
                    }
                    Err(e) => {
                        if attempt < 4 {
                            warn!("Failed to load schedule (attempt {}), retrying in 2s: {e}", attempt + 1);
                            tokio::time::sleep(Duration::from_secs(2)).await;
                        } else {
                            error!("Failed to load schedule after 5 attempts: {e}");
                        }
                    }
                }
            }
        }
        Ok(WsMessage::TerminalStart { session_id, cols, rows }) => {
            terminal_mgr.start_session(session_id, cols, rows);
        }
        Ok(WsMessage::TerminalInput { session_id, data }) => {
            terminal_mgr.write_input(&session_id, &data);
        }
        Ok(WsMessage::TerminalResize { session_id, cols, rows }) => {
            terminal_mgr.resize(&session_id, cols, rows);
        }
        Ok(WsMessage::TerminalExit { session_id, .. }) => {
            terminal_mgr.kill_session(&session_id);
        }
        Ok(WsMessage::Ping { timestamp }) => {
            info!("Received ping, sending pong");
            let pong = serde_json::to_string(&WsMessage::Pong { timestamp }).unwrap_or_default();
            if let Err(e) = resp_tx.send(pong).await {
                error!("Failed to send pong: {e}");
            }
        }
        Ok(WsMessage::RestartAgent) => {
            warn!("Restart agent requested — restarting via systemctl");
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
        Ok(other) => {
            debug!("Ignoring unexpected message: {other:?}");
        }
        Err(e) => {
            warn!("Failed to parse server message: {e} -- raw: {text}");
        }
    }
}
