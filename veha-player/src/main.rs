use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use clap::Parser;
use image::{ImageBuffer, Rgb};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use veha_core::audio::AudioPlayer;
use veha_core::command::{PlayerCommand, PlayerStatus};
use veha_core::decoder::{AVDecoder, DecodedFrame};
use veha_core::player::PlayerState;
use veha_core::playlist::{MediaItem, Playlist};
use veha_core::sink::OutputSink;
use veha_core::VideoFrame;

mod config;
mod ipc;
mod keyboard;

use config::PlayerConfig;
use keyboard::KeyAction;

/// A sink wrapper that delegates to an inner sink and stores the last written frame.
struct CapturingSink {
    inner: Box<dyn OutputSink>,
    last_frame: Arc<Mutex<Option<VideoFrame>>>,
}

impl OutputSink for CapturingSink {
    fn write_frame(&mut self, frame: &VideoFrame) -> veha_core::Result<()> {
        *lock_or_default(&self.last_frame) = Some(frame.clone());
        self.inner.write_frame(frame)
    }

    fn resolution(&self) -> (u32, u32) {
        self.inner.resolution()
    }

    fn is_open(&self) -> bool {
        self.inner.is_open()
    }

    fn poll_events(&mut self) -> Vec<veha_core::SinkEvent> {
        self.inner.poll_events()
    }

    fn toggle_fullscreen(&mut self) -> veha_core::Result<()> {
        self.inner.toggle_fullscreen()
    }

    fn is_fullscreen(&self) -> bool {
        self.inner.is_fullscreen()
    }
}

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

/// Shared media control state between the command loop and the player thread.
struct MediaState {
    playlist: Arc<Mutex<Option<Playlist>>>,
    player_state: Arc<Mutex<PlayerState>>,
    current_index: Arc<Mutex<usize>>,
    skip_signal: Arc<Mutex<Option<SkipDirection>>>,
    last_frame: Arc<Mutex<Option<VideoFrame>>>,
    // Media controls
    volume: Arc<Mutex<f32>>,
    is_muted: Arc<Mutex<bool>>,
    playback_speed: Arc<Mutex<f32>>,
    is_fullscreen: Arc<Mutex<bool>>,
    seek_target: Arc<Mutex<Option<f64>>>,
    position_secs: Arc<Mutex<f64>>,
    duration_secs: Arc<Mutex<Option<f64>>>,
}

impl MediaState {
    fn new(fullscreen: bool) -> Self {
        Self {
            playlist: Arc::new(Mutex::new(None)),
            player_state: Arc::new(Mutex::new(PlayerState::Stopped)),
            current_index: Arc::new(Mutex::new(0)),
            skip_signal: Arc::new(Mutex::new(None)),
            last_frame: Arc::new(Mutex::new(None)),
            volume: Arc::new(Mutex::new(1.0)),
            is_muted: Arc::new(Mutex::new(false)),
            playback_speed: Arc::new(Mutex::new(1.0)),
            is_fullscreen: Arc::new(Mutex::new(fullscreen)),
            seek_target: Arc::new(Mutex::new(None)),
            position_secs: Arc::new(Mutex::new(0.0)),
            duration_secs: Arc::new(Mutex::new(None)),
        }
    }

    fn clone_arcs(&self) -> Self {
        Self {
            playlist: self.playlist.clone(),
            player_state: self.player_state.clone(),
            current_index: self.current_index.clone(),
            skip_signal: self.skip_signal.clone(),
            last_frame: self.last_frame.clone(),
            volume: self.volume.clone(),
            is_muted: self.is_muted.clone(),
            playback_speed: self.playback_speed.clone(),
            is_fullscreen: self.is_fullscreen.clone(),
            seek_target: self.seek_target.clone(),
            position_secs: self.position_secs.clone(),
            duration_secs: self.duration_secs.clone(),
        }
    }
}

fn make_status(ms: &MediaState) -> PlayerStatus {
    let state = *lock_or_default(&ms.player_state);
    let idx = *lock_or_default(&ms.current_index);
    let pl = lock_or_default(&ms.playlist);
    let current = pl.as_ref().and_then(|p| p.items.get(idx));

    PlayerStatus {
        state: format!("{state:?}"),
        current_item: current.map(|i| i.source.clone()),
        current_index: idx,
        total_items: pl.as_ref().map(|p| p.len()).unwrap_or(0),
        playlist_name: pl.as_ref().map(|p| p.name.clone()),
        active_booking_id: current.and_then(|i| i.booking_id.clone()),
        active_creative_id: current.and_then(|i| i.creative_id.clone()),
        active_media_id: current.and_then(|i| i.media_id.clone()),
        uptime_secs: None,
        position_secs: Some(*lock_or_default(&ms.position_secs)),
        duration_secs: *lock_or_default(&ms.duration_secs),
        volume: *lock_or_default(&ms.volume),
        is_muted: *lock_or_default(&ms.is_muted),
        playback_speed: *lock_or_default(&ms.playback_speed),
        is_fullscreen: *lock_or_default(&ms.is_fullscreen),
        system_metrics: None,
    }
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
        "Starting veha-player: {}x{} backend={} fullscreen={}",
        config.width, config.height, config.output_backend, config.fullscreen
    );

    // Create command channel
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<(
        PlayerCommand,
        Option<tokio::sync::oneshot::Sender<PlayerStatus>>,
    )>(32);

    let ms = MediaState::new(config.fullscreen);

    // Load default playlist if configured
    if let Some(ref playlist_path) = config.default_playlist {
        match Playlist::from_json_file(playlist_path) {
            Ok(playlist) => {
                info!(
                    "Loaded default playlist: {} ({} items)",
                    playlist.name,
                    playlist.len()
                );
                *lock_or_default(&ms.playlist) = Some(playlist);
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

    let play_ms = ms.clone_arcs();
    let play_config = config.clone();
    let player_handle = std::thread::spawn(move || {
        run_player_loop(play_config, play_ms);
    });

    // Command processing loop
    while let Some((cmd, resp_tx)) = cmd_rx.recv().await {
        match cmd {
            PlayerCommand::Play | PlayerCommand::Resume => {
                *lock_or_default(&ms.player_state) = PlayerState::Playing;
                info!("Command: Play/Resume");
            }
            PlayerCommand::Pause => {
                *lock_or_default(&ms.player_state) = PlayerState::Paused;
                info!("Command: Pause");
            }
            PlayerCommand::Stop => {
                *lock_or_default(&ms.player_state) = PlayerState::Stopped;
                info!("Command: Stop");
            }
            PlayerCommand::Next => {
                *lock_or_default(&ms.skip_signal) = Some(SkipDirection::Next);
                info!("Command: Next");
            }
            PlayerCommand::Previous => {
                *lock_or_default(&ms.skip_signal) = Some(SkipDirection::Previous);
                info!("Command: Previous");
            }
            PlayerCommand::LoadPlaylist(json) => match serde_json::from_str::<Playlist>(&json) {
                Ok(playlist) => {
                    info!(
                        "Loading playlist: {} ({} items)",
                        playlist.name,
                        playlist.len()
                    );
                    *lock_or_default(&ms.playlist) = Some(playlist);
                    *lock_or_default(&ms.current_index) = 0;
                    *lock_or_default(&ms.player_state) = PlayerState::Playing;
                }
                Err(e) => error!("Failed to parse playlist: {e}"),
            },
            PlayerCommand::TakeScreenshot(path) => {
                let frame_opt = lock_or_default(&ms.last_frame).clone();
                let frame = frame_opt.unwrap_or_else(|| {
                    // No content playing — produce a black frame matching the output resolution
                    VideoFrame {
                        width: config.width,
                        height: config.height,
                        data: vec![0u8; (config.width * config.height * 3) as usize],
                        pts: None,
                        time_base: (0, 1),
                    }
                });
                match ImageBuffer::<Rgb<u8>, _>::from_raw(
                    frame.width,
                    frame.height,
                    frame.data.clone(),
                ) {
                    Some(img) => {
                        if let Err(e) = img.save(&path) {
                            error!("Failed to save screenshot to {path}: {e}");
                        } else {
                            info!("Screenshot saved to {path}");
                        }
                    }
                    None => {
                        error!("Failed to create image buffer from frame data");
                    }
                }
            }
            PlayerCommand::Seek(pos) => {
                *lock_or_default(&ms.seek_target) = Some(pos.max(0.0));
                info!("Command: Seek to {pos:.1}s");
            }
            PlayerCommand::SeekRelative(delta) => {
                let current = *lock_or_default(&ms.position_secs);
                let target = (current + delta).max(0.0);
                *lock_or_default(&ms.seek_target) = Some(target);
                info!("Command: SeekRelative {delta:+.1}s → {target:.1}s");
            }
            PlayerCommand::SetVolume(v) => {
                let v = v.clamp(0.0, 1.0);
                *lock_or_default(&ms.volume) = v;
                info!("Command: SetVolume {v:.2}");
            }
            PlayerCommand::Mute => {
                let mut m = lock_or_default(&ms.is_muted);
                *m = !*m;
                info!("Command: Mute toggled to {}", *m);
            }
            PlayerCommand::SetSpeed(s) => {
                let s = s.clamp(0.25, 4.0);
                *lock_or_default(&ms.playback_speed) = s;
                info!("Command: SetSpeed {s:.2}x");
            }
            PlayerCommand::ToggleFullscreen => {
                let mut fs = lock_or_default(&ms.is_fullscreen);
                *fs = !*fs;
                info!("Command: ToggleFullscreen → {}", *fs);
            }
            PlayerCommand::GetStatus => {
                let status = make_status(&ms);
                if let Some(tx) = resp_tx {
                    let _ = tx.send(status);
                }
                continue;
            }
        }

        // Send ack for non-GetStatus commands
        if let Some(tx) = resp_tx {
            let status = make_status(&ms);
            let _ = tx.send(status);
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

fn run_player_loop(config: PlayerConfig, ms: MediaState) {
    // Create output sink based on config
    let inner_sink: Box<dyn OutputSink> = match config.output_backend.as_str() {
        "window" => {
            let result = if config.fullscreen {
                veha_output::WindowSink::new_fullscreen(&config.title, config.width, config.height)
            } else {
                veha_output::WindowSink::new(&config.title, config.width, config.height)
            };
            match result {
                Ok(s) => Box::new(s),
                Err(e) => {
                    tracing::error!("Failed to create window sink: {e}. Falling back to null.");
                    Box::new(veha_output::NullSink::new(config.width, config.height))
                }
            }
        }
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

    let mut sink: Box<dyn OutputSink> = Box::new(CapturingSink {
        inner: inner_sink,
        last_frame: ms.last_frame.clone(),
    });

    // Initialize audio player
    let mut audio: Option<AudioPlayer> = match AudioPlayer::new() {
        Ok(a) => {
            info!("Audio output initialized");
            Some(a)
        }
        Err(e) => {
            warn!("No audio output available: {e}");
            None
        }
    };

    // Track current fullscreen state locally to detect changes from commands
    let mut local_fullscreen = config.fullscreen;

    loop {
        // Handle fullscreen toggle requested via commands
        let desired_fs = *lock_or_default(&ms.is_fullscreen);
        if desired_fs != local_fullscreen {
            if let Err(e) = sink.toggle_fullscreen() {
                warn!("Failed to toggle fullscreen: {e}");
                *lock_or_default(&ms.is_fullscreen) = local_fullscreen;
            } else {
                local_fullscreen = desired_fs;
                info!("Fullscreen toggled to {local_fullscreen}");
            }
        }

        // Check if we should be playing
        let current_state = *lock_or_default(&ms.player_state);
        if current_state == PlayerState::Stopped || current_state == PlayerState::Paused {
            // Poll events even when paused/stopped so keyboard works
            let events = sink.poll_events();
            let actions = keyboard::map_events(&events);
            for action in actions {
                handle_key_action(action, &ms, &mut audio, &mut sink, &mut local_fullscreen);
            }

            std::thread::sleep(Duration::from_millis(50));
            if !sink.is_open() {
                break;
            }
            continue;
        }

        // Get current playlist and index
        let pl = lock_or_default(&ms.playlist).clone();
        let idx = *lock_or_default(&ms.current_index);

        if let Some(ref pl) = pl {
            if pl.is_empty() {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }

            let actual_idx = idx % pl.len();
            let item = &pl.items[actual_idx];

            info!(
                "Playing item {}/{}: {}",
                actual_idx + 1,
                pl.len(),
                item.source
            );

            // Play the item with A/V decoding
            if veha_core::image::is_image_path(&item.source) {
                play_image(item, &mut sink, &ms, &mut audio, &mut local_fullscreen);
            } else {
                play_video_av(item, &mut sink, &ms, &mut audio, &mut local_fullscreen);
            }

            // Check for skip signal
            let skip = lock_or_default(&ms.skip_signal).take();
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
                    *lock_or_default(&ms.current_index) = 0;
                } else {
                    *lock_or_default(&ms.player_state) = PlayerState::Stopped;
                    *lock_or_default(&ms.current_index) = 0;
                }
            } else {
                *lock_or_default(&ms.current_index) = next_idx;
            }
        } else {
            // No playlist — poll events and wait
            let events = sink.poll_events();
            let actions = keyboard::map_events(&events);
            for action in actions {
                handle_key_action(action, &ms, &mut audio, &mut sink, &mut local_fullscreen);
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if !sink.is_open() {
            break;
        }
    }

    info!("Player loop exited");
}

/// Play a video item with A/V decoding, audio output, keyboard controls, and seek.
fn play_video_av(
    item: &MediaItem,
    sink: &mut Box<dyn OutputSink>,
    ms: &MediaState,
    audio: &mut Option<AudioPlayer>,
    local_fullscreen: &mut bool,
) {
    let (target_w, target_h) = sink.resolution();

    let mut decoder = match AVDecoder::open(&item.source, target_w, target_h) {
        Ok(d) => d,
        Err(e) => {
            warn!("Failed to open {}: {e}", item.source);
            return;
        }
    };

    let fps = decoder.frame_rate().unwrap_or(30.0);
    let frame_duration = Duration::from_secs_f64(1.0 / fps);
    let playback_start = Instant::now();

    // Store duration
    *lock_or_default(&ms.duration_secs) = decoder.duration_secs();
    *lock_or_default(&ms.position_secs) = 0.0;

    // Sync audio state
    if let Some(ap) = audio.as_mut() {
        ap.flush();
        let vol = *lock_or_default(&ms.volume);
        ap.set_volume(vol);
        let muted = *lock_or_default(&ms.is_muted);
        if muted != ap.is_muted() {
            ap.toggle_mute();
        }
        let speed = *lock_or_default(&ms.playback_speed);
        ap.set_speed(speed);
    }

    loop {
        // Check state
        let state = *lock_or_default(&ms.player_state);
        if state == PlayerState::Stopped {
            break;
        }

        // Handle pause
        if state == PlayerState::Paused {
            if let Some(ap) = audio.as_ref() {
                ap.pause();
            }
            loop {
                let events = sink.poll_events();
                let actions = keyboard::map_events(&events);
                for action in actions {
                    handle_key_action(action, ms, audio, sink, local_fullscreen);
                }
                std::thread::sleep(Duration::from_millis(50));
                if !sink.is_open() {
                    return;
                }
                let s = *lock_or_default(&ms.player_state);
                if s != PlayerState::Paused {
                    if s == PlayerState::Playing {
                        if let Some(ap) = audio.as_ref() {
                            ap.resume();
                        }
                    }
                    break;
                }
            }
            if *lock_or_default(&ms.player_state) == PlayerState::Stopped {
                break;
            }
        }

        // Check for skip
        if lock_or_default(&ms.skip_signal).is_some() {
            break;
        }

        // Check duration limit
        if let Some(max_dur) = item.effective_duration() {
            if playback_start.elapsed() >= max_dur {
                break;
            }
        }

        // Handle seek
        if let Some(target) = lock_or_default(&ms.seek_target).take() {
            if let Err(e) = decoder.seek(target) {
                warn!("Seek failed: {e}");
            } else {
                if let Some(ap) = audio.as_mut() {
                    ap.flush();
                }
                *lock_or_default(&ms.position_secs) = target;
                continue;
            }
        }

        // Sync volume/speed from shared state
        if let Some(ap) = audio.as_mut() {
            let vol = *lock_or_default(&ms.volume);
            if (vol - ap.volume()).abs() > 0.001 {
                ap.set_volume(vol);
            }
            let muted = *lock_or_default(&ms.is_muted);
            if muted != ap.is_muted() {
                ap.toggle_mute();
            }
            let speed = *lock_or_default(&ms.playback_speed);
            if (speed - ap.speed()).abs() > 0.001 {
                ap.set_speed(speed);
            }
        }

        // Get next frame from decoder
        let frame_result = match decoder.next() {
            Some(r) => r,
            None => break, // EOF
        };

        // Process decoded frame
        match frame_result {
            Ok(DecodedFrame::Audio(af)) => {
                if let Some(ap) = audio.as_ref() {
                    ap.push_samples(&af.samples, af.sample_rate, af.channels);
                }
            }
            Ok(DecodedFrame::Video(vf)) => {
                // Track position
                if let Some(ts) = vf.timestamp_secs() {
                    *lock_or_default(&ms.position_secs) = ts;
                }

                // Simple frame pacing based on frame duration
                let frame_start = Instant::now();
                if let Err(e) = sink.write_frame(&vf) {
                    warn!("Frame write error: {e}");
                    break;
                }

                // Poll keyboard events during frame display
                let events = sink.poll_events();
                let actions = keyboard::map_events(&events);
                for action in actions {
                    handle_key_action(action, ms, audio, sink, local_fullscreen);
                }

                // Handle fullscreen toggle
                let desired_fs = *lock_or_default(&ms.is_fullscreen);
                if desired_fs != *local_fullscreen {
                    if let Err(e) = sink.toggle_fullscreen() {
                        warn!("Failed to toggle fullscreen: {e}");
                        *lock_or_default(&ms.is_fullscreen) = *local_fullscreen;
                    } else {
                        *local_fullscreen = desired_fs;
                    }
                }

                // Frame timing
                let speed = *lock_or_default(&ms.playback_speed);
                let adjusted_duration = frame_duration.mul_f32(1.0 / speed);
                let elapsed = frame_start.elapsed();
                if elapsed < adjusted_duration {
                    std::thread::sleep(adjusted_duration - elapsed);
                }
            }
            Err(e) => {
                warn!("Decode error: {e}");
            }
        }

        if !sink.is_open() {
            return;
        }
    }

    // Clean up audio for this item
    if let Some(ap) = audio.as_mut() {
        ap.flush();
    }
    *lock_or_default(&ms.duration_secs) = None;
}

/// Play a static image for its display duration.
fn play_image(
    item: &MediaItem,
    sink: &mut Box<dyn OutputSink>,
    ms: &MediaState,
    audio: &mut Option<AudioPlayer>,
    local_fullscreen: &mut bool,
) {
    let (target_w, target_h) = sink.resolution();

    let frame = match veha_core::image::decode_image(&item.source, target_w, target_h) {
        Ok(f) => f,
        Err(e) => {
            warn!("Failed to decode image {}: {e}", item.source);
            return;
        }
    };

    let display_duration = item
        .effective_duration()
        .unwrap_or(Duration::from_secs(5));
    let start = Instant::now();

    *lock_or_default(&ms.duration_secs) = Some(display_duration.as_secs_f64());
    *lock_or_default(&ms.position_secs) = 0.0;

    while sink.is_open() && start.elapsed() < display_duration {
        let state = *lock_or_default(&ms.player_state);
        if state == PlayerState::Stopped {
            break;
        }
        if lock_or_default(&ms.skip_signal).is_some() {
            break;
        }

        if let Err(e) = sink.write_frame(&frame) {
            warn!("Frame write error: {e}");
            break;
        }

        *lock_or_default(&ms.position_secs) = start.elapsed().as_secs_f64();

        // Poll keyboard events
        let events = sink.poll_events();
        let actions = keyboard::map_events(&events);
        for action in actions {
            handle_key_action(action, ms, audio, sink, local_fullscreen);
        }

        // Handle fullscreen toggle
        let desired_fs = *lock_or_default(&ms.is_fullscreen);
        if desired_fs != *local_fullscreen {
            if let Err(e) = sink.toggle_fullscreen() {
                warn!("Failed to toggle fullscreen: {e}");
                *lock_or_default(&ms.is_fullscreen) = *local_fullscreen;
            } else {
                *local_fullscreen = desired_fs;
            }
        }

        std::thread::sleep(Duration::from_millis(16));
    }

    *lock_or_default(&ms.duration_secs) = None;
}

/// Handle a keyboard action by updating shared state.
fn handle_key_action(
    action: KeyAction,
    ms: &MediaState,
    audio: &mut Option<AudioPlayer>,
    sink: &mut Box<dyn OutputSink>,
    local_fullscreen: &mut bool,
) {
    match action {
        KeyAction::PlayPause => {
            let mut state = lock_or_default(&ms.player_state);
            match *state {
                PlayerState::Playing => {
                    *state = PlayerState::Paused;
                    if let Some(ap) = audio.as_ref() {
                        ap.pause();
                    }
                }
                PlayerState::Paused => {
                    *state = PlayerState::Playing;
                    if let Some(ap) = audio.as_ref() {
                        ap.resume();
                    }
                }
                PlayerState::Stopped => {
                    *state = PlayerState::Playing;
                }
            }
        }
        KeyAction::SeekForward => {
            let current = *lock_or_default(&ms.position_secs);
            *lock_or_default(&ms.seek_target) = Some(current + 5.0);
        }
        KeyAction::SeekBackward => {
            let current = *lock_or_default(&ms.position_secs);
            *lock_or_default(&ms.seek_target) = Some((current - 5.0).max(0.0));
        }
        KeyAction::VolumeUp => {
            let mut vol = lock_or_default(&ms.volume);
            *vol = (*vol + 0.05).min(1.0);
            let v = *vol;
            drop(vol);
            if let Some(ap) = audio.as_mut() {
                ap.set_volume(v);
            }
        }
        KeyAction::VolumeDown => {
            let mut vol = lock_or_default(&ms.volume);
            *vol = (*vol - 0.05).max(0.0);
            let v = *vol;
            drop(vol);
            if let Some(ap) = audio.as_mut() {
                ap.set_volume(v);
            }
        }
        KeyAction::Mute => {
            let mut m = lock_or_default(&ms.is_muted);
            *m = !*m;
            drop(m);
            if let Some(ap) = audio.as_mut() {
                ap.toggle_mute();
            }
        }
        KeyAction::ToggleFullscreen => {
            let new_fs = !*lock_or_default(&ms.is_fullscreen);
            if let Err(e) = sink.toggle_fullscreen() {
                warn!("Failed to toggle fullscreen: {e}");
            } else {
                *lock_or_default(&ms.is_fullscreen) = new_fs;
                *local_fullscreen = new_fs;
            }
        }
        KeyAction::Next => {
            *lock_or_default(&ms.skip_signal) = Some(SkipDirection::Next);
        }
        KeyAction::Previous => {
            *lock_or_default(&ms.skip_signal) = Some(SkipDirection::Previous);
        }
        KeyAction::SpeedUp => {
            let mut speed = lock_or_default(&ms.playback_speed);
            *speed = (*speed + 0.25).min(4.0);
            let s = *speed;
            drop(speed);
            if let Some(ap) = audio.as_mut() {
                ap.set_speed(s);
            }
        }
        KeyAction::SpeedDown => {
            let mut speed = lock_or_default(&ms.playback_speed);
            *speed = (*speed - 0.25).max(0.25);
            let s = *speed;
            drop(speed);
            if let Some(ap) = audio.as_mut() {
                ap.set_speed(s);
            }
        }
        KeyAction::SeekPercent(pct) => {
            let dur = *lock_or_default(&ms.duration_secs);
            if let Some(d) = dur {
                let target = d * (pct as f64 / 100.0);
                *lock_or_default(&ms.seek_target) = Some(target);
            }
        }
        KeyAction::Quit => {
            *lock_or_default(&ms.player_state) = PlayerState::Stopped;
        }
    }
}
