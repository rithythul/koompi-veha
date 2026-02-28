use std::path::Path;
use std::sync::{Arc, Mutex};

use clap::Parser;
use tokio::sync::mpsc;
use tracing::{error, info};

use veha_core::command::{PlayerCommand, PlayerStatus};
use veha_core::player::PlayerState;
use veha_core::playlist::Playlist;
use veha_core::sink::OutputSink;
use veha_core::Player;

mod config;
mod ipc;

use config::PlayerConfig;

/// Lock a mutex, recovering from poisoning by returning the inner data.
fn lock_or_default<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| {
        tracing::error!("Mutex poisoned, recovering with previous state");
        poisoned.into_inner()
    })
}

#[derive(Parser)]
#[command(name = "veha-player", about = "koompi-veha headless player daemon")]
struct Args {
    /// Path to config file (TOML)
    #[arg(short, long, default_value = "veha-player.toml")]
    config: String,
}

#[derive(Debug, Clone, Copy)]
enum SkipDirection {
    Next,
    Previous,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    veha_core::init().expect("FFmpeg initialization failed — check FFmpeg libraries are installed");

    let args = Args::parse();

    let config = if Path::new(&args.config).exists() {
        PlayerConfig::from_file(&args.config).unwrap_or_else(|e| {
            error!("Failed to load config: {e}, using defaults");
            PlayerConfig::default()
        })
    } else {
        info!("No config file found, using defaults");
        PlayerConfig::default()
    };

    info!(
        "Starting veha-player: {}x{} backend={}",
        config.width, config.height, config.output_backend
    );

    // Create command channel
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<(
        PlayerCommand,
        Option<tokio::sync::oneshot::Sender<PlayerStatus>>,
    )>(32);

    // Shared state for player
    let current_playlist: Arc<Mutex<Option<Playlist>>> = Arc::new(Mutex::new(None));
    let player_state: Arc<Mutex<PlayerState>> = Arc::new(Mutex::new(PlayerState::Stopped));
    let current_index: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    let skip_signal: Arc<Mutex<Option<SkipDirection>>> = Arc::new(Mutex::new(None));

    // Load default playlist if configured
    if let Some(ref playlist_path) = config.default_playlist {
        match Playlist::from_json_file(playlist_path) {
            Ok(playlist) => {
                info!(
                    "Loaded default playlist: {} ({} items)",
                    playlist.name,
                    playlist.len()
                );
                *lock_or_default(&current_playlist) = Some(playlist);
            }
            Err(e) => error!("Failed to load default playlist: {e}"),
        }
    }

    // Start IPC server
    let ipc_socket = config.socket_path.clone();
    let ipc_cmd_tx = cmd_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = ipc::start_ipc_server(&ipc_socket, ipc_cmd_tx).await {
            error!("IPC server error: {e}");
        }
    });

    // Signal handler — sets shutdown flag and cleans up socket
    let socket_path_for_cleanup = config.socket_path.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        info!("Shutdown signal received");
        let _ = std::fs::remove_file(&socket_path_for_cleanup);
        std::process::exit(0);
    });

    // Player loop runs in a blocking thread (FFmpeg is synchronous)
    let play_playlist = current_playlist.clone();
    let play_state = player_state.clone();
    let play_index = current_index.clone();
    let play_skip = skip_signal.clone();
    let play_config = config.clone();

    let player_handle = std::thread::spawn(move || {
        run_player_loop(
            play_config,
            play_playlist,
            play_state,
            play_index,
            play_skip,
        );
    });

    // Command processing loop
    let cmd_playlist = current_playlist.clone();
    let cmd_state = player_state.clone();
    let cmd_index = current_index.clone();
    let cmd_skip = skip_signal.clone();

    while let Some((cmd, resp_tx)) = cmd_rx.recv().await {
        match cmd {
            PlayerCommand::Play | PlayerCommand::Resume => {
                *lock_or_default(&cmd_state) = PlayerState::Playing;
                info!("Command: Play/Resume");
            }
            PlayerCommand::Pause => {
                *lock_or_default(&cmd_state) = PlayerState::Paused;
                info!("Command: Pause");
            }
            PlayerCommand::Stop => {
                *lock_or_default(&cmd_state) = PlayerState::Stopped;
                info!("Command: Stop");
            }
            PlayerCommand::Next => {
                *lock_or_default(&cmd_skip) = Some(SkipDirection::Next);
                info!("Command: Next");
            }
            PlayerCommand::Previous => {
                *lock_or_default(&cmd_skip) = Some(SkipDirection::Previous);
                info!("Command: Previous");
            }
            PlayerCommand::LoadPlaylist(json) => match serde_json::from_str::<Playlist>(&json) {
                Ok(playlist) => {
                    info!(
                        "Loading playlist: {} ({} items)",
                        playlist.name,
                        playlist.len()
                    );
                    *lock_or_default(&cmd_playlist) = Some(playlist);
                    *lock_or_default(&cmd_index) = 0;
                    *lock_or_default(&cmd_state) = PlayerState::Playing;
                }
                Err(e) => error!("Failed to parse playlist: {e}"),
            },
            PlayerCommand::GetStatus => {
                let state = *lock_or_default(&cmd_state);
                let idx = *lock_or_default(&cmd_index);
                let pl = lock_or_default(&cmd_playlist);

                let status = PlayerStatus {
                    state: format!("{state:?}"),
                    current_item: pl
                        .as_ref()
                        .and_then(|p| p.items.get(idx).map(|i| i.source.clone())),
                    current_index: idx,
                    total_items: pl.as_ref().map(|p| p.len()).unwrap_or(0),
                    playlist_name: pl.as_ref().map(|p| p.name.clone()),
                    active_booking_id: None,
                    active_creative_id: None,
                    uptime_secs: None,
                };

                if let Some(tx) = resp_tx {
                    let _ = tx.send(status);
                }
                continue; // already sent response
            }
        }

        // Send ack for non-GetStatus commands
        if let Some(tx) = resp_tx {
            let _ = tx.send(PlayerStatus {
                state: format!("{:?}", *lock_or_default(&cmd_state)),
                current_item: None,
                current_index: 0,
                total_items: 0,
                playlist_name: None,
                active_booking_id: None,
                active_creative_id: None,
                uptime_secs: None,
            });
        }
    }

    // Monitor player thread
    match player_handle.join() {
        Ok(()) => info!("Player thread exited normally"),
        Err(panic_payload) => {
            let msg = if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else if let Some(s) = panic_payload.downcast_ref::<&str>() {
                s.to_string()
            } else {
                "unknown panic".to_string()
            };
            error!("Player thread panicked: {msg}");
            std::process::exit(1);
        }
    }
}

fn run_player_loop(
    config: PlayerConfig,
    playlist: Arc<Mutex<Option<Playlist>>>,
    state: Arc<Mutex<PlayerState>>,
    current_index: Arc<Mutex<usize>>,
    skip_signal: Arc<Mutex<Option<SkipDirection>>>,
) {
    // Create output sink based on config
    let mut sink: Box<dyn OutputSink> = match config.output_backend.as_str() {
        "window" => match veha_output::WindowSink::new(&config.title, config.width, config.height) {
            Ok(s) => Box::new(s),
            Err(e) => {
                tracing::error!("Failed to create window sink: {e}. Falling back to null.");
                Box::new(veha_output::NullSink::new(config.width, config.height))
            }
        },
        #[cfg(feature = "framebuffer")]
        "framebuffer" => match veha_output::FramebufferSink::new(0) {
            Ok(s) => Box::new(s),
            Err(e) => {
                tracing::error!("Failed to open framebuffer: {e}. Falling back to null.");
                Box::new(veha_output::NullSink::new(config.width, config.height))
            }
        },
        #[cfg(not(feature = "framebuffer"))]
        "framebuffer" => {
            tracing::error!(
                "Framebuffer backend requested but not compiled in. \
                 Rebuild with --features framebuffer. Falling back to null."
            );
            Box::new(veha_output::NullSink::new(config.width, config.height))
        }
        "null" => Box::new(veha_output::NullSink::new(config.width, config.height)),
        other => {
            tracing::error!("Unknown backend: {other}, falling back to null");
            Box::new(veha_output::NullSink::new(config.width, config.height))
        }
    };

    let mut player = Player::new();

    loop {
        // Check if we should be playing
        let current_state = *lock_or_default(&state);
        if current_state == PlayerState::Stopped {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !sink.is_open() {
                break;
            }
            continue;
        }

        if current_state == PlayerState::Paused {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if !sink.is_open() {
                break;
            }
            continue;
        }

        // Get current playlist and index
        let pl = lock_or_default(&playlist).clone();
        let idx = *lock_or_default(&current_index);

        if let Some(ref pl) = pl {
            if pl.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }

            let actual_idx = idx % pl.len();
            let item = &pl.items[actual_idx];

            tracing::info!(
                "Playing item {}/{}: {}",
                actual_idx + 1,
                pl.len(),
                item.source
            );

            // Play the item (blocks until done or interrupted)
            if let Err(e) = player.play_item(item, sink.as_mut()) {
                tracing::warn!("Error playing {}: {e}", item.source);
            }

            // Check for skip signal
            let skip = lock_or_default(&skip_signal).take();
            let next_idx = match skip {
                Some(SkipDirection::Next) => actual_idx + 1,
                Some(SkipDirection::Previous) => {
                    if actual_idx == 0 {
                        pl.len() - 1
                    } else {
                        actual_idx - 1
                    }
                }
                None => actual_idx + 1,
            };

            if next_idx >= pl.len() {
                if pl.loop_playlist {
                    *lock_or_default(&current_index) = 0;
                } else {
                    *lock_or_default(&state) = PlayerState::Stopped;
                    *lock_or_default(&current_index) = 0;
                }
            } else {
                *lock_or_default(&current_index) = next_idx;
            }
        } else {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        if !sink.is_open() {
            break;
        }
    }

    tracing::info!("Player loop exited");
}
