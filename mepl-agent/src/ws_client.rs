use futures::{SinkExt, StreamExt};
use mepl_core::command::{PlayerCommand, PlayerStatus};
use serde::{Deserialize, Serialize};
use tokio::time::{self, Duration};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::config::AgentConfig;
use crate::player_client;

/// Messages exchanged over the WebSocket (duplicated from mepl-api since we
/// cannot depend on that crate).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register { board_id: String },
    Ack { ok: bool },
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
    let report_interval = Duration::from_secs(config.report_interval_secs);
    let mut status_ticker = time::interval(report_interval);

    loop {
        tokio::select! {
            // Incoming message from the API server
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_message(&text, &socket_path).await;
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

            // Periodic status report
            _ = status_ticker.tick() => {
                match player_client::get_status(&socket_path).await {
                    Ok(status) => {
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
                        };
                        let msg = serde_json::to_string(&WsMessage::Status { status })?;
                        let _ = ws_tx.send(Message::Text(msg.into())).await;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handle a text message received from the API server.
async fn handle_server_message(text: &str, socket_path: &str) {
    match serde_json::from_str::<WsMessage>(text) {
        Ok(WsMessage::Command { command }) => {
            info!("Received command: {command:?}");
            match player_client::send_command(socket_path, &command).await {
                Ok(resp) => debug!("Player response: {resp}"),
                Err(e) => error!("Failed to forward command to player: {e}"),
            }
        }
        Ok(other) => {
            debug!("Ignoring unexpected message: {other:?}");
        }
        Err(e) => {
            warn!("Failed to parse server message: {e} -- raw: {text}");
        }
    }
}
