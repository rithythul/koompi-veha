use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use tracing::{error, info};

use dooh_core::command::{PlayerCommand, PlayerStatus};

/// Start the IPC server listening on a Unix socket.
/// Commands received are forwarded via the command_tx channel.
/// Status responses come back via a per-connection oneshot channel.
pub async fn start_ipc_server(
    socket_path: &str,
    command_tx: mpsc::Sender<(
        PlayerCommand,
        Option<tokio::sync::oneshot::Sender<PlayerStatus>>,
    )>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Remove stale socket
    let _ = std::fs::remove_file(socket_path);

    let listener = UnixListener::bind(socket_path)?;
    info!("IPC server listening on {socket_path}");

    loop {
        let (stream, _) = listener.accept().await?;
        let cmd_tx = command_tx.clone();

        tokio::spawn(async move {
            let (reader, mut writer) = stream.into_split();
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            const MAX_LINE_LEN: usize = 1024 * 1024; // 1MB max command

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        if line.len() > MAX_LINE_LEN {
                            let err_response = serde_json::json!({"error": "message too large"});
                            let _ = writer
                                .write_all(format!("{err_response}\n").as_bytes())
                                .await;
                            break;
                        }
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<PlayerCommand>(trimmed) {
                            Ok(cmd) => {
                                let needs_response = matches!(cmd, PlayerCommand::GetStatus);

                                if needs_response {
                                    let (resp_tx, resp_rx) = tokio::sync::oneshot::channel();
                                    if cmd_tx.send((cmd, Some(resp_tx))).await.is_err() {
                                        break;
                                    }
                                    if let Ok(status) = resp_rx.await {
                                        let response =
                                            serde_json::to_string(&status).unwrap_or_default();
                                        let _ = writer
                                            .write_all(format!("{response}\n").as_bytes())
                                            .await;
                                    }
                                } else {
                                    let response = serde_json::json!({"ok": true});
                                    if cmd_tx.send((cmd, None)).await.is_err() {
                                        break;
                                    }
                                    let _ = writer
                                        .write_all(format!("{response}\n").as_bytes())
                                        .await;
                                }
                            }
                            Err(e) => {
                                let err_response = serde_json::json!({"error": e.to_string()});
                                let _ = writer
                                    .write_all(format!("{err_response}\n").as_bytes())
                                    .await;
                            }
                        }
                    }
                    Err(e) => {
                        error!("IPC read error: {e}");
                        break;
                    }
                }
            }
        });
    }
}
