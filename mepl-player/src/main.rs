use std::path::Path;
use std::sync::{Arc, Mutex};

use clap::Parser;
use tokio::sync::mpsc;
use tracing::{error, info};

use mepl_core::command::{PlayerCommand, PlayerStatus};
use mepl_core::player::PlayerState;
use mepl_core::playlist::Playlist;
use mepl_core::sink::OutputSink;
use mepl_core::Player;

mod config;
mod ipc;

use config::PlayerConfig;

#[derive(Parser)]
#[command(name = "mepl-player", about = "koompi-mepl headless player daemon")]
struct Args {
    /// Path to config file (TOML)
    #[arg(short, long, default_value = "mepl-player.toml")]
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
    mepl_core::init();

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
        "Starting mepl-player: {}x{} backend={}",
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
                *current_playlist.lock().unwrap() = Some(playlist);
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
                *cmd_state.lock().unwrap() = PlayerState::Playing;
                info!("Command: Play/Resume");
            }
            PlayerCommand::Pause => {
                *cmd_state.lock().unwrap() = PlayerState::Paused;
                info!("Command: Pause");
            }
            PlayerCommand::Stop => {
                *cmd_state.lock().unwrap() = PlayerState::Stopped;
                info!("Command: Stop");
            }
            PlayerCommand::Next => {
                *cmd_skip.lock().unwrap() = Some(SkipDirection::Next);
                info!("Command: Next");
            }
            PlayerCommand::Previous => {
                *cmd_skip.lock().unwrap() = Some(SkipDirection::Previous);
                info!("Command: Previous");
            }
            PlayerCommand::LoadPlaylist(json) => match serde_json::from_str::<Playlist>(&json) {
                Ok(playlist) => {
                    info!(
                        "Loading playlist: {} ({} items)",
                        playlist.name,
                        playlist.len()
                    );
                    *cmd_playlist.lock().unwrap() = Some(playlist);
                    *cmd_index.lock().unwrap() = 0;
                    *cmd_state.lock().unwrap() = PlayerState::Playing;
                }
                Err(e) => error!("Failed to parse playlist: {e}"),
            },
            PlayerCommand::GetStatus => {
                let state = *cmd_state.lock().unwrap();
                let idx = *cmd_index.lock().unwrap();
                let pl = cmd_playlist.lock().unwrap();

                let status = PlayerStatus {
                    state: format!("{state:?}"),
                    current_item: pl
                        .as_ref()
                        .and_then(|p| p.items.get(idx).map(|i| i.source.clone())),
                    current_index: idx,
                    total_items: pl.as_ref().map(|p| p.len()).unwrap_or(0),
                    playlist_name: pl.as_ref().map(|p| p.name.clone()),
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
                state: format!("{:?}", *cmd_state.lock().unwrap()),
                current_item: None,
                current_index: 0,
                total_items: 0,
                playlist_name: None,
            });
        }
    }

    player_handle.join().ok();
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
        "window" => Box::new(
            mepl_output::WindowSink::new(&config.title, config.width, config.height)
                .expect("Failed to create window"),
        ),
        "null" => Box::new(mepl_output::NullSink::new(config.width, config.height)),
        other => {
            tracing::error!("Unknown backend: {other}, falling back to null");
            Box::new(mepl_output::NullSink::new(config.width, config.height))
        }
    };

    let mut player = Player::new();

    loop {
        // Check if we should be playing
        let current_state = *state.lock().unwrap();
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
        let pl = playlist.lock().unwrap().clone();
        let idx = *current_index.lock().unwrap();

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
            let skip = skip_signal.lock().unwrap().take();
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
                    *current_index.lock().unwrap() = 0;
                } else {
                    *state.lock().unwrap() = PlayerState::Stopped;
                    *current_index.lock().unwrap() = 0;
                }
            } else {
                *current_index.lock().unwrap() = next_idx;
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
