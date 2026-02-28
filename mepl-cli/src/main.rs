use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};

use mepl_core::{Decoder, OutputSink, Player};
use mepl_output::WindowSink;

#[derive(Parser)]
#[command(name = "mepl", about = "koompi-mepl media player")]
struct Cli {
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
}

fn main() {
    tracing_subscriber::fmt::init();
    mepl_core::init();

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
    }
}

fn play(source: &str, width: Option<u32>, height: Option<u32>) -> mepl_core::Result<()> {
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

    let mut sink = WindowSink::new(&format!("mepl - {source}"), w, h)?;

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
) -> mepl_core::Result<()> {
    let playlist = mepl_core::Playlist::from_json_file(playlist_path)?;
    let (w, h) = match (width, height) {
        (Some(w), Some(h)) => (w, h),
        _ => (1920, 1080), // default resolution for playlists
    };

    println!(
        "Playing playlist: {} ({} items)",
        playlist.name,
        playlist.len()
    );

    let mut sink = WindowSink::new(&format!("mepl - {}", playlist.name), w, h)?;
    let mut player = Player::new();
    player.play_playlist(&playlist, &mut sink)?;

    println!("Playlist finished.");
    Ok(())
}
