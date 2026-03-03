//! Remote terminal (PTY) session management for the veha-agent.
//!
//! Each terminal session spawns a shell in a pseudo-terminal and bridges
//! I/O over the existing WebSocket connection using TerminalInput/TerminalOutput
//! messages.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info, warn};

use crate::ws_client::WsMessage;

/// Handle to a running terminal session.
struct Session {
    /// Writer to feed stdin data to the PTY.
    writer: Box<dyn Write + Send>,
    /// Handle to the PTY master for resize operations.
    pty_master: Box<dyn portable_pty::MasterPty + Send>,
    /// Channel to signal the reader task to stop.
    _cancel: tokio::sync::oneshot::Sender<()>,
}

/// Manages all active terminal sessions for this agent.
pub struct TerminalManager {
    sessions: HashMap<String, Session>,
    /// Channel to send WsMessages back out through the WebSocket.
    ws_tx: mpsc::Sender<String>,
}

impl TerminalManager {
    pub fn new(ws_tx: mpsc::Sender<String>) -> Self {
        Self {
            sessions: HashMap::new(),
            ws_tx,
        }
    }

    /// Start a new terminal session with the given ID and initial size.
    pub fn start_session(&mut self, session_id: String, cols: u16, rows: u16) {
        if self.sessions.contains_key(&session_id) {
            warn!("Terminal session {session_id} already exists, ignoring start");
            return;
        }

        info!("Starting terminal session {session_id} ({cols}x{rows})");

        let pty_system = NativePtySystem::default();
        let pty_pair = match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(e) => {
                error!("Failed to open PTY for session {session_id}: {e}");
                let exit_msg = WsMessage::TerminalExit {
                    session_id,
                    code: Some(-1),
                };
                let ws_tx = self.ws_tx.clone();
                tokio::spawn(async move {
                    let _ = ws_tx
                        .send(serde_json::to_string(&exit_msg).unwrap_or_default())
                        .await;
                });
                return;
            }
        };

        // Spawn a shell
        let mut cmd = CommandBuilder::new_default_prog();
        cmd.env("TERM", "xterm-256color");

        let child = match pty_pair.slave.spawn_command(cmd) {
            Ok(child) => child,
            Err(e) => {
                error!("Failed to spawn shell for session {session_id}: {e}");
                let exit_msg = WsMessage::TerminalExit {
                    session_id,
                    code: Some(-1),
                };
                let ws_tx = self.ws_tx.clone();
                tokio::spawn(async move {
                    let _ = ws_tx
                        .send(serde_json::to_string(&exit_msg).unwrap_or_default())
                        .await;
                });
                return;
            }
        };

        // We need to drop the slave to avoid blocking reads when the child exits
        drop(pty_pair.slave);

        let writer = pty_pair.master.take_writer().unwrap();
        let mut reader = pty_pair.master.try_clone_reader().unwrap();

        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let ws_tx = self.ws_tx.clone();

        // Spawn a blocking thread to read PTY output and forward it
        let child = Arc::new(Mutex::new(child));
        let child_clone = child.clone();
        let spawn_session_id = session_id.clone();
        tokio::spawn(async move {
            let mut cancel_rx = cancel_rx;
            let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(64);

            let reader_sid = spawn_session_id.clone();
            // Blocking reader thread
            let reader_handle = std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            debug!("PTY read error for {reader_sid}: {e}");
                            break;
                        }
                    }
                }
            });

            let sid = spawn_session_id;
            loop {
                tokio::select! {
                    data = output_rx.recv() => {
                        match data {
                            Some(bytes) => {
                                // Send as base64 to safely transport binary data
                                let b64 = base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    &bytes,
                                );
                                let msg = WsMessage::TerminalOutput {
                                    session_id: sid.clone(),
                                    data: b64,
                                };
                                if let Ok(json) = serde_json::to_string(&msg) {
                                    if ws_tx.send(json).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            None => break, // reader thread exited
                        }
                    }
                    _ = &mut cancel_rx => {
                        debug!("Terminal session {sid} cancelled");
                        break;
                    }
                }
            }

            // Wait for the child process
            let exit_code = {
                let mut child = child_clone.lock().await;
                match child.try_wait() {
                    Ok(Some(status)) => status.exit_code() as i32,
                    _ => {
                        child.kill().ok();
                        -1
                    }
                }
            };

            let _ = reader_handle.join();

            info!("Terminal session {sid} exited with code {exit_code}");
            let exit_msg = WsMessage::TerminalExit {
                session_id: sid,
                code: Some(exit_code),
            };
            let _ = ws_tx
                .send(serde_json::to_string(&exit_msg).unwrap_or_default())
                .await;
        });

        self.sessions.insert(
            session_id,
            Session {
                writer,
                pty_master: pty_pair.master,
                _cancel: cancel_tx,
            },
        );
    }

    /// Write input data to a terminal session.
    pub fn write_input(&mut self, session_id: &str, data: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            // Data is base64-encoded
            let bytes = match base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                data,
            ) {
                Ok(b) => b,
                Err(e) => {
                    warn!("Invalid base64 terminal input for {session_id}: {e}");
                    return;
                }
            };
            if let Err(e) = session.writer.write_all(&bytes) {
                warn!("Failed to write to terminal {session_id}: {e}");
                self.kill_session(session_id);
            }
        } else {
            debug!("Terminal input for unknown session {session_id}");
        }
    }

    /// Resize a terminal session.
    pub fn resize(&mut self, session_id: &str, cols: u16, rows: u16) {
        if let Some(session) = self.sessions.get(session_id) {
            if let Err(e) = session.pty_master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            }) {
                warn!("Failed to resize terminal {session_id}: {e}");
            } else {
                debug!("Resized terminal {session_id} to {cols}x{rows}");
            }
        }
    }

    /// Kill and remove a terminal session.
    pub fn kill_session(&mut self, session_id: &str) {
        if let Some(_session) = self.sessions.remove(session_id) {
            info!("Killed terminal session {session_id}");
            // Dropping the Session will drop cancel_tx, signalling the reader task to stop
        }
    }

    /// Kill all active sessions (called on disconnect).
    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            self.kill_session(&id);
        }
    }
}
