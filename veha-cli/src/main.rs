use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

use veha_core::{Decoder, OutputSink, Player};
use veha_output::WindowSink;

// ── CLI argument structs ────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "veha", about = "koompi-veha media player")]
struct Cli {
    /// API server URL (default: http://localhost:3000)
    #[arg(long, global = true, default_value = "http://localhost:3000")]
    api_url: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Play a media file or stream URL.
    Play {
        /// Path to a video file or stream URL (rtsp://, rtmp://, http://).
        source: String,

        /// Target width (defaults to source resolution).
        #[arg(long)]
        width: Option<u32>,

        /// Target height (defaults to source resolution).
        #[arg(long)]
        height: Option<u32>,
    },

    /// Play a JSON playlist file.
    PlayPlaylist {
        /// Path to playlist JSON file.
        playlist: String,

        #[arg(long)]
        width: Option<u32>,

        #[arg(long)]
        height: Option<u32>,
    },

    /// Manage boards.
    Boards(BoardsArgs),

    /// Manage media files.
    Media(MediaArgs),

    /// Manage playlists.
    Playlists(PlaylistsArgs),

    /// Upload a media file to the API server.
    Upload {
        /// Path to the file to upload.
        file: String,
    },
}

#[derive(clap::Args)]
struct BoardsArgs {
    #[command(subcommand)]
    command: BoardsCommand,
}

#[derive(Subcommand)]
enum BoardsCommand {
    /// List all boards.
    List,

    /// Get board status.
    Status {
        /// Board ID.
        id: String,
    },

    /// Send a command to a board (play, pause, resume, stop, next, previous).
    Command {
        /// Board ID.
        id: String,

        /// Command to send (play, pause, resume, stop, next, previous).
        command: String,
    },
}

#[derive(clap::Args)]
struct MediaArgs {
    #[command(subcommand)]
    command: MediaCommand,
}

#[derive(Subcommand)]
enum MediaCommand {
    /// List all media files.
    List,
}

#[derive(clap::Args)]
struct PlaylistsArgs {
    #[command(subcommand)]
    command: PlaylistsCommand,
}

#[derive(Subcommand)]
enum PlaylistsCommand {
    /// List all playlists.
    List,

    /// Create a new playlist via the API.
    Create {
        /// Playlist name.
        name: String,

        /// Comma-separated media sources (paths or URLs).
        #[arg(long)]
        items: String,

        /// Loop the playlist.
        #[arg(long, default_value_t = false)]
        loop_playlist: bool,
    },
}

// ── API response types (mirror the server models) ───────────────────────

#[derive(Debug, Deserialize)]
struct BoardResponse {
    id: String,
    name: String,
    status: String,
    last_seen: Option<String>,
    group_id: Option<String>,
    #[allow(dead_code)]
    config: Option<String>,
    #[allow(dead_code)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MediaResponse {
    id: String,
    name: String,
    #[allow(dead_code)]
    filename: Option<String>,
    #[allow(dead_code)]
    mime_type: Option<String>,
    size: i64,
    uploaded_at: String,
}

#[derive(Debug, Deserialize)]
struct PlaylistResponse {
    id: String,
    name: String,
    items: Vec<PlaylistItem>,
    loop_playlist: bool,
    created_at: String,
    #[allow(dead_code)]
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlaylistItem {
    #[allow(dead_code)]
    source: String,
    #[allow(dead_code)]
    duration: Option<f64>,
    #[allow(dead_code)]
    name: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreatePlaylistRequest {
    name: String,
    items: Vec<CreatePlaylistItem>,
    loop_playlist: bool,
}

#[derive(Debug, Serialize)]
struct CreatePlaylistItem {
    source: String,
}

#[derive(Debug, Serialize)]
struct CommandRequest {
    command: CommandBody,
}

#[derive(Debug, Serialize)]
struct CommandBody {
    #[serde(rename = "type")]
    command_type: String,
}

// ── Main ────────────────────────────────────────────────────────────────

fn main() {
    tracing_subscriber::fmt::init();
    veha_core::init().expect("FFmpeg initialization failed — check FFmpeg libraries are installed");

    let cli = Cli::parse();

    match cli.command {
        Commands::Play {
            source,
            width,
            height,
        } => {
            if let Err(e) = play(&source, width, height) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::PlayPlaylist {
            playlist,
            width,
            height,
        } => {
            if let Err(e) = play_playlist(&playlist, width, height) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Boards(args) => {
            run_async(handle_boards(cli.api_url, args));
        }
        Commands::Media(args) => {
            run_async(handle_media(cli.api_url, args));
        }
        Commands::Playlists(args) => {
            run_async(handle_playlists(cli.api_url, args));
        }
        Commands::Upload { file } => {
            run_async(handle_upload(cli.api_url, file));
        }
    }
}

/// Run an async future on a tokio runtime.
fn run_async<F: std::future::Future<Output = ()>>(f: F) {
    tokio::runtime::Runtime::new()
        .expect("Failed to create tokio runtime")
        .block_on(f);
}

// ── Async command handlers ──────────────────────────────────────────────

async fn handle_boards(api_url: String, args: BoardsArgs) {
    match args.command {
        BoardsCommand::List => {
            boards_list(&api_url).await;
        }
        BoardsCommand::Status { id } => {
            boards_status(&api_url, &id).await;
        }
        BoardsCommand::Command { id, command } => {
            boards_command(&api_url, &id, &command).await;
        }
    }
}

async fn handle_media(api_url: String, args: MediaArgs) {
    match args.command {
        MediaCommand::List => {
            media_list(&api_url).await;
        }
    }
}

async fn handle_playlists(api_url: String, args: PlaylistsArgs) {
    match args.command {
        PlaylistsCommand::List => {
            playlists_list(&api_url).await;
        }
        PlaylistsCommand::Create {
            name,
            items,
            loop_playlist,
        } => {
            playlists_create(&api_url, &name, &items, loop_playlist).await;
        }
    }
}

// ── Boards ──────────────────────────────────────────────────────────────

async fn boards_list(api_url: &str) {
    let url = format!("{api_url}/api/boards");
    let client = reqwest::Client::new();

    match client.get(&url).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<Vec<BoardResponse>>().await {
                Ok(boards) => {
                    if boards.is_empty() {
                        println!("No boards found.");
                        return;
                    }
                    println!(
                        "{:<38} {:<20} {:<10} {}",
                        "ID", "NAME", "STATUS", "LAST SEEN"
                    );
                    for b in &boards {
                        let last_seen = format_last_seen(b.last_seen.as_deref());
                        println!(
                            "{:<38} {:<20} {:<10} {}",
                            b.id, b.name, b.status, last_seen
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Error parsing response: {e}");
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

async fn boards_status(api_url: &str, id: &str) {
    let url = format!("{api_url}/api/boards/{id}");
    let client = reqwest::Client::new();

    match client.get(&url).send().await {
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                eprintln!("Error: board not found: {id}");
                std::process::exit(1);
            }
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<BoardResponse>().await {
                Ok(board) => {
                    println!("Board: {}", board.name);
                    println!("ID:     {}", board.id);
                    println!("Status: {}", board.status);
                    if let Some(group) = &board.group_id {
                        println!("Group:  {group}");
                    }
                    let last_seen = format_last_seen(board.last_seen.as_deref());
                    println!("Last seen: {last_seen}");
                }
                Err(e) => {
                    eprintln!("Error parsing response: {e}");
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

async fn boards_command(api_url: &str, id: &str, command: &str) {
    let command_type = match command.to_lowercase().as_str() {
        "play" => "Play",
        "pause" => "Pause",
        "resume" => "Resume",
        "stop" => "Stop",
        "next" => "Next",
        "previous" => "Previous",
        other => {
            eprintln!(
                "Error: unknown command '{other}'. Supported: play, pause, resume, stop, next, previous"
            );
            std::process::exit(1);
        }
    };

    let url = format!("{api_url}/api/boards/{id}/command");
    let client = reqwest::Client::new();
    let body = CommandRequest {
        command: CommandBody {
            command_type: command_type.to_string(),
        },
    };

    match client.post(&url).json(&body).send().await {
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                eprintln!("Error: board not found or not connected: {id}");
                std::process::exit(1);
            }
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            println!("Command sent: {command_type}");
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

// ── Upload ──────────────────────────────────────────────────────────────

async fn handle_upload(api_url: String, file: String) {
    let path = Path::new(&file);
    if !path.exists() {
        eprintln!("Error: file not found: {file}");
        std::process::exit(1);
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file.clone());

    let file_bytes = match std::fs::read(path) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Error reading file: {e}");
            std::process::exit(1);
        }
    };

    let size = file_bytes.len();
    let size_str = format_size(size as i64);

    eprint!("Uploading {file_name}...");

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone())
        .mime_str("application/octet-stream")
        .unwrap();
    let form = reqwest::multipart::Form::new().part("file", part);

    let url = format!("{api_url}/api/media");
    let client = reqwest::Client::new();

    match client.post(&url).multipart(form).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                eprintln!(" failed");
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<MediaResponse>().await {
                Ok(media) => {
                    eprintln!(" done ({size_str})");
                    println!("Media ID: {}", media.id);
                }
                Err(_) => {
                    eprintln!(" done ({size_str})");
                    println!("Upload complete (could not parse response).");
                }
            }
        }
        Err(e) => {
            eprintln!(" failed");
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

// ── Media ───────────────────────────────────────────────────────────────

async fn media_list(api_url: &str) {
    let url = format!("{api_url}/api/media");
    let client = reqwest::Client::new();

    match client.get(&url).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<Vec<MediaResponse>>().await {
                Ok(media) => {
                    if media.is_empty() {
                        println!("No media files found.");
                        return;
                    }
                    println!(
                        "{:<38} {:<30} {:<12} {}",
                        "ID", "NAME", "SIZE", "UPLOADED"
                    );
                    for m in &media {
                        let size = format_size(m.size);
                        println!(
                            "{:<38} {:<30} {:<12} {}",
                            m.id, m.name, size, m.uploaded_at
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Error parsing response: {e}");
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

// ── Playlists ───────────────────────────────────────────────────────────

async fn playlists_list(api_url: &str) {
    let url = format!("{api_url}/api/playlists");
    let client = reqwest::Client::new();

    match client.get(&url).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<Vec<PlaylistResponse>>().await {
                Ok(playlists) => {
                    if playlists.is_empty() {
                        println!("No playlists found.");
                        return;
                    }
                    println!(
                        "{:<38} {:<25} {:<8} {:<6} {}",
                        "ID", "NAME", "ITEMS", "LOOP", "CREATED"
                    );
                    for p in &playlists {
                        let loop_str = if p.loop_playlist { "yes" } else { "no" };
                        println!(
                            "{:<38} {:<25} {:<8} {:<6} {}",
                            p.id,
                            p.name,
                            p.items.len(),
                            loop_str,
                            p.created_at
                        );
                    }
                }
                Err(e) => {
                    eprintln!("Error parsing response: {e}");
                    std::process::exit(1);
                }
            }
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

async fn playlists_create(api_url: &str, name: &str, items_csv: &str, loop_playlist: bool) {
    let items: Vec<CreatePlaylistItem> = items_csv
        .split(',')
        .map(|s| CreatePlaylistItem {
            source: s.trim().to_string(),
        })
        .collect();

    let body = CreatePlaylistRequest {
        name: name.to_string(),
        items,
        loop_playlist,
    };

    let url = format!("{api_url}/api/playlists");
    let client = reqwest::Client::new();

    match client.post(&url).json(&body).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                eprintln!("Error: server returned {}", resp.status());
                std::process::exit(1);
            }
            match resp.json::<PlaylistResponse>().await {
                Ok(playlist) => {
                    println!("Playlist created:");
                    println!("  ID:    {}", playlist.id);
                    println!("  Name:  {}", playlist.name);
                    println!("  Items: {}", playlist.items.len());
                    println!("  Loop:  {}", playlist.loop_playlist);
                }
                Err(_) => {
                    println!("Playlist created successfully.");
                }
            }
        }
        Err(e) => {
            eprintln!("Error connecting to API: {e}");
            std::process::exit(1);
        }
    }
}

// ── Local playback (existing) ───────────────────────────────────────────

fn play(source: &str, width: Option<u32>, height: Option<u32>) -> veha_core::Result<()> {
    let decoder = match (width, height) {
        (Some(w), Some(h)) => Decoder::open(source, w, h)?,
        _ => Decoder::open_native(source)?,
    };

    let (w, h) = decoder.target_resolution();
    let fps = decoder.frame_rate().unwrap_or(30.0);
    let frame_duration = Duration::from_secs_f64(1.0 / fps);

    println!(
        "Playing: {source}  |  {}x{} -> {w}x{h}  |  {fps:.1} fps",
        decoder.source_resolution().0,
        decoder.source_resolution().1,
    );

    let mut sink = WindowSink::new(&format!("veha - {source}"), w, h)?;

    for frame_result in decoder {
        if !sink.is_open() {
            break;
        }

        let frame_start = Instant::now();
        let frame = frame_result?;
        sink.write_frame(&frame)?;

        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            thread::sleep(frame_duration - elapsed);
        }
    }

    println!("Playback finished.");
    Ok(())
}

fn play_playlist(
    playlist_path: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> veha_core::Result<()> {
    let playlist = veha_core::Playlist::from_json_file(playlist_path)?;
    let (w, h) = match (width, height) {
        (Some(w), Some(h)) => (w, h),
        _ => (1920, 1080), // default resolution for playlists
    };

    println!(
        "Playing playlist: {} ({} items)",
        playlist.name,
        playlist.len()
    );

    let mut sink = WindowSink::new(&format!("veha - {}", playlist.name), w, h)?;
    let mut player = Player::new();
    player.play_playlist(&playlist, &mut sink)?;

    println!("Playlist finished.");
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn format_size(bytes: i64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{bytes} B")
    }
}

fn format_last_seen(last_seen: Option<&str>) -> String {
    match last_seen {
        Some(ts) if !ts.is_empty() => ts.to_string(),
        _ => "never".to_string(),
    }
}
