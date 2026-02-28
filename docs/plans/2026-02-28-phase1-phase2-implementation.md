# koompi-veha Phase 1 & 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core FFmpeg media player library and a windowed output backend that can decode and display video files, images, and streams in a desktop window.

**Architecture:** Cargo workspace with two crates — `veha-core` (library wrapping FFmpeg for decoding, frame pipeline, and playlist) and `veha-output` (pluggable output backends, starting with a `minifb` window backend). A `veha-cli` binary ties them together for testing.

**Tech Stack:** Rust, ffmpeg-next (FFmpeg bindings), minifb (window framebuffer), clap (CLI), thiserror (errors), tracing (logging)

---

### Task 1: Initialize Cargo Workspace

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `veha-core/Cargo.toml`
- Create: `veha-core/src/lib.rs`
- Create: `veha-output/Cargo.toml`
- Create: `veha-output/src/lib.rs`
- Create: `veha-cli/Cargo.toml`
- Create: `veha-cli/src/main.rs`
- Create: `.gitignore`

**Step 1: Create workspace root Cargo.toml**

```toml
[workspace]
members = ["veha-core", "veha-output", "veha-cli"]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2024"
license = "MIT"
repository = "https://github.com/koompi/koompi-veha"

[workspace.dependencies]
veha-core = { path = "veha-core" }
veha-output = { path = "veha-output" }
thiserror = "2"
tracing = "0.1"
tracing-subscriber = "0.3"
```

**Step 2: Create veha-core crate**

`veha-core/Cargo.toml`:
```toml
[package]
name = "veha-core"
version.workspace = true
edition.workspace = true

[dependencies]
ffmpeg-next = "7"
thiserror.workspace = true
tracing.workspace = true
```

`veha-core/src/lib.rs`:
```rust
pub mod error;

pub use error::Error;
pub type Result<T> = std::result::Result<T, Error>;
```

Create `veha-core/src/error.rs`:
```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("FFmpeg error: {0}")]
    Ffmpeg(#[from] ffmpeg_next::Error),

    #[error("No video stream found")]
    NoVideoStream,

    #[error("No audio stream found")]
    NoAudioStream,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}
```

**Step 3: Create veha-output crate**

`veha-output/Cargo.toml`:
```toml
[package]
name = "veha-output"
version.workspace = true
edition.workspace = true

[features]
default = ["window"]
window = ["dep:minifb"]

[dependencies]
veha-core.workspace = true
minifb = { version = "0.28", optional = true }
thiserror.workspace = true
tracing.workspace = true
```

`veha-output/src/lib.rs`:
```rust
#[cfg(feature = "window")]
pub mod window;
```

**Step 4: Create veha-cli crate**

`veha-cli/Cargo.toml`:
```toml
[package]
name = "veha-cli"
version.workspace = true
edition.workspace = true

[dependencies]
veha-core.workspace = true
veha-output.workspace = true
clap = { version = "4", features = ["derive"] }
tracing.workspace = true
tracing-subscriber.workspace = true
```

`veha-cli/src/main.rs`:
```rust
fn main() {
    println!("koompi-veha");
}
```

**Step 5: Create .gitignore**

```
/target
```

**Step 6: Build to verify workspace compiles**

Run: `cargo build`
Expected: Compiles successfully with no errors.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize cargo workspace with veha-core, veha-output, veha-cli"
```

---

### Task 2: Video Frame Type and OutputSink Trait

**Files:**
- Create: `veha-core/src/frame.rs`
- Create: `veha-core/src/sink.rs`
- Modify: `veha-core/src/lib.rs`

**Step 1: Create the VideoFrame type**

`veha-core/src/frame.rs`:
```rust
/// A decoded video frame in RGB24 format (3 bytes per pixel).
#[derive(Clone)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pts: Option<i64>,
    pub time_base: (i32, i32),
}

impl VideoFrame {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            data: vec![0u8; (width * height * 3) as usize],
            width,
            height,
            pts: None,
            time_base: (1, 30),
        }
    }

    /// Convert RGB24 frame data to packed u32 ARGB (0x00RRGGBB) for display backends.
    pub fn to_argb_u32(&self) -> Vec<u32> {
        self.data
            .chunks_exact(3)
            .map(|rgb| {
                let r = rgb[0] as u32;
                let g = rgb[1] as u32;
                let b = rgb[2] as u32;
                (r << 16) | (g << 8) | b
            })
            .collect()
    }

    /// Timestamp in seconds (if PTS is available).
    pub fn timestamp_secs(&self) -> Option<f64> {
        self.pts.map(|pts| {
            pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64
        })
    }
}
```

**Step 2: Create the OutputSink trait**

`veha-core/src/sink.rs`:
```rust
use crate::frame::VideoFrame;
use crate::Result;

/// Trait for output backends that can display video frames.
pub trait OutputSink: Send {
    /// Write a decoded video frame to the output.
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()>;

    /// The target resolution this sink expects.
    fn resolution(&self) -> (u32, u32);

    /// Whether the sink is still open/active (e.g. window not closed).
    fn is_open(&self) -> bool;
}
```

**Step 3: Update lib.rs exports**

`veha-core/src/lib.rs`:
```rust
pub mod error;
pub mod frame;
pub mod sink;

pub use error::Error;
pub use frame::VideoFrame;
pub use sink::OutputSink;

pub type Result<T> = std::result::Result<T, Error>;

/// Initialize FFmpeg. Call once at program start.
pub fn init() {
    ffmpeg_next::init().expect("Failed to initialize FFmpeg");
}
```

**Step 4: Build to verify**

Run: `cargo build`
Expected: Compiles successfully.

**Step 5: Commit**

```bash
git add veha-core/src/frame.rs veha-core/src/sink.rs veha-core/src/lib.rs
git commit -m "feat(core): add VideoFrame type and OutputSink trait"
```

---

### Task 3: Video Decoder

**Files:**
- Create: `veha-core/src/decoder.rs`
- Modify: `veha-core/src/lib.rs`
- Modify: `veha-core/src/error.rs`

**Step 1: Implement the video decoder**

`veha-core/src/decoder.rs`:
```rust
use std::path::Path;

use ffmpeg_next::format::{input, Pixel};
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as ScalerContext, flag::Flags};
use ffmpeg_next::util::frame::video::Video;

use crate::frame::VideoFrame;
use crate::Result;
use crate::error::Error;

/// Decodes video frames from a media source.
pub struct Decoder {
    input_ctx: ffmpeg_next::format::context::Input,
    decoder: ffmpeg_next::decoder::Video,
    scaler: ScalerContext,
    video_stream_index: usize,
    time_base: (i32, i32),
    target_width: u32,
    target_height: u32,
}

impl Decoder {
    /// Open a media file or stream URL for decoding.
    pub fn open(source: &str, target_width: u32, target_height: u32) -> Result<Self> {
        let input_ctx = input(&source)?;

        let stream = input_ctx
            .streams()
            .best(Type::Video)
            .ok_or(Error::NoVideoStream)?;

        let video_stream_index = stream.index();
        let time_base = stream.time_base();

        let context_decoder =
            ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = context_decoder.decoder().video()?;

        let scaler = ScalerContext::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            Pixel::RGB24,
            target_width,
            target_height,
            Flags::BILINEAR,
        )?;

        Ok(Self {
            input_ctx,
            decoder,
            scaler,
            video_stream_index,
            time_base: (time_base.numerator(), time_base.denominator()),
            target_width,
            target_height,
        })
    }

    /// Open with the source's native resolution (no scaling).
    pub fn open_native(source: &str) -> Result<Self> {
        // We need to peek at the resolution first.
        let input_ctx = input(&source)?;
        let stream = input_ctx
            .streams()
            .best(Type::Video)
            .ok_or(Error::NoVideoStream)?;
        let context_decoder =
            ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
        let dec = context_decoder.decoder().video()?;
        let w = dec.width();
        let h = dec.height();
        drop(dec);
        drop(context_decoder);
        drop(input_ctx);

        Self::open(source, w, h)
    }

    /// Get the source video's native resolution.
    pub fn source_resolution(&self) -> (u32, u32) {
        (self.decoder.width(), self.decoder.height())
    }

    /// Get the target (output) resolution.
    pub fn target_resolution(&self) -> (u32, u32) {
        (self.target_width, self.target_height)
    }

    /// Get the stream time base as (numerator, denominator).
    pub fn time_base(&self) -> (i32, i32) {
        self.time_base
    }

    /// Get approximate frame rate (fps) if available.
    pub fn frame_rate(&self) -> Option<f64> {
        let rate = self.decoder.frame_rate();
        rate.map(|r| r.numerator() as f64 / r.denominator() as f64)
    }
}

/// Iterator that yields decoded VideoFrames.
impl Iterator for Decoder {
    type Item = Result<VideoFrame>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut decoded = Video::empty();
        let mut rgb_frame = Video::empty();

        // Try to receive a frame from pending decoded data first.
        if self.decoder.receive_frame(&mut decoded).is_ok() {
            if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                return Some(Err(e.into()));
            }
            return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
        }

        // Send packets until we get a frame.
        loop {
            // Find next video packet.
            let mut found_packet = false;
            for (stream, packet) in self.input_ctx.packets() {
                if stream.index() == self.video_stream_index {
                    if let Err(e) = self.decoder.send_packet(&packet) {
                        return Some(Err(e.into()));
                    }
                    found_packet = true;
                    break;
                }
            }

            if !found_packet {
                // EOF — flush decoder.
                let _ = self.decoder.send_eof();
                if self.decoder.receive_frame(&mut decoded).is_ok() {
                    if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                        return Some(Err(e.into()));
                    }
                    return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
                }
                return None;
            }

            // Try to receive the decoded frame.
            if self.decoder.receive_frame(&mut decoded).is_ok() {
                if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                    return Some(Err(e.into()));
                }
                return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
            }
            // If no frame yet, continue sending packets.
        }
    }
}

impl Decoder {
    fn ffmpeg_frame_to_video_frame(&self, rgb: &Video, original: &Video) -> VideoFrame {
        let width = rgb.width();
        let height = rgb.height();
        let stride = rgb.stride(0);
        let pixel_width = (width * 3) as usize;

        // Copy row-by-row to handle stride != width*3.
        let mut data = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height as usize {
            let row_start = y * stride;
            let row_end = row_start + pixel_width;
            data.extend_from_slice(&rgb.data(0)[row_start..row_end]);
        }

        VideoFrame {
            data,
            width,
            height,
            pts: original.pts(),
            time_base: self.time_base,
        }
    }
}
```

**Step 2: Update lib.rs**

Add to `veha-core/src/lib.rs`:
```rust
pub mod decoder;
pub use decoder::Decoder;
```

**Step 3: Build to verify**

Run: `cargo build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add veha-core/src/decoder.rs veha-core/src/lib.rs
git commit -m "feat(core): add video decoder with FFmpeg demuxing and RGB24 scaling"
```

---

### Task 4: Window Output Backend (veha-output)

**Files:**
- Create: `veha-output/src/window.rs`
- Modify: `veha-output/src/lib.rs`

**Step 1: Implement window backend**

`veha-output/src/window.rs`:
```rust
use veha_core::frame::VideoFrame;
use veha_core::sink::OutputSink;
use veha_core::Result;
use veha_core::error::Error;
use minifb::{Window, WindowOptions};

/// A windowed output backend using minifb.
pub struct WindowSink {
    window: Window,
    width: u32,
    height: u32,
}

impl WindowSink {
    /// Create a new window with the given title and resolution.
    pub fn new(title: &str, width: u32, height: u32) -> Result<Self> {
        let window = Window::new(
            title,
            width as usize,
            height as usize,
            WindowOptions {
                resize: true,
                scale_mode: minifb::ScaleMode::AspectRatioStretch,
                ..WindowOptions::default()
            },
        )
        .map_err(|e| Error::Other(format!("Failed to create window: {e}")))?;

        Ok(Self {
            window,
            width,
            height,
        })
    }

    /// Access the underlying window (for checking key input, etc.).
    pub fn window(&self) -> &Window {
        &self.window
    }

    /// Access the underlying window mutably.
    pub fn window_mut(&mut self) -> &mut Window {
        &mut self.window
    }
}

impl OutputSink for WindowSink {
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()> {
        let buffer = frame.to_argb_u32();
        self.window
            .update_with_buffer(&buffer, frame.width as usize, frame.height as usize)
            .map_err(|e| Error::Other(format!("Window update failed: {e}")))?;
        Ok(())
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_open(&self) -> bool {
        self.window.is_open()
    }
}
```

**Step 2: Update lib.rs**

`veha-output/src/lib.rs`:
```rust
#[cfg(feature = "window")]
pub mod window;

#[cfg(feature = "window")]
pub use window::WindowSink;
```

**Step 3: Build to verify**

Run: `cargo build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add veha-output/src/window.rs veha-output/src/lib.rs
git commit -m "feat(output): add minifb window output backend"
```

---

### Task 5: CLI Player — Play a Video File in a Window

**Files:**
- Modify: `veha-cli/src/main.rs`

**Step 1: Implement the CLI with play command**

`veha-cli/src/main.rs`:
```rust
use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tracing_subscriber;

use veha_core::{Decoder, OutputSink};
use veha_output::WindowSink;

#[derive(Parser)]
#[command(name = "veha", about = "koompi-veha media player")]
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
}

fn main() {
    tracing_subscriber::fmt::init();

    veha_core::init();

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
    }
}

fn play(source: &str, width: Option<u32>, height: Option<u32>) -> veha_core::Result<()> {
    // Open decoder — use target resolution if specified, otherwise native.
    let mut decoder = match (width, height) {
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

    for frame_result in &mut decoder {
        if !sink.is_open() {
            break;
        }

        let frame_start = Instant::now();
        let frame = frame_result?;
        sink.write_frame(&frame)?;

        // Simple frame-rate throttle.
        let elapsed = frame_start.elapsed();
        if elapsed < frame_duration {
            thread::sleep(frame_duration - elapsed);
        }
    }

    println!("Playback finished.");
    Ok(())
}
```

**Step 2: Build and test with a video file**

Run: `cargo build --release`
Expected: Compiles successfully.

Run: `cargo run --release -- play /path/to/test-video.mp4`
Expected: A window opens and plays the video at its native resolution with frame-rate pacing.

**Step 3: Commit**

```bash
git add veha-cli/src/main.rs
git commit -m "feat(cli): add play command with windowed video playback"
```

---

### Task 6: Image Decoding Support

**Files:**
- Create: `veha-core/src/image.rs`
- Modify: `veha-core/src/lib.rs`
- Modify: `veha-core/src/error.rs`
- Modify: `veha-cli/src/main.rs`

**Step 1: Implement image decoder**

`veha-core/src/image.rs`:
```rust
use std::path::Path;

use ffmpeg_next::format::{input, Pixel};
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as ScalerContext, flag::Flags};
use ffmpeg_next::util::frame::video::Video;

use crate::error::Error;
use crate::frame::VideoFrame;
use crate::Result;

/// Decode a single image file into a VideoFrame.
pub fn decode_image(path: &str, target_width: u32, target_height: u32) -> Result<VideoFrame> {
    let mut input_ctx = input(&path)?;

    let stream = input_ctx
        .streams()
        .best(Type::Video)
        .ok_or(Error::NoVideoStream)?;

    let stream_index = stream.index();
    let context_decoder =
        ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = context_decoder.decoder().video()?;

    let mut scaler = ScalerContext::get(
        decoder.format(),
        decoder.width(),
        decoder.height(),
        Pixel::RGB24,
        target_width,
        target_height,
        Flags::BILINEAR,
    )?;

    for (stream, packet) in input_ctx.packets() {
        if stream.index() == stream_index {
            decoder.send_packet(&packet)?;
            let mut decoded = Video::empty();
            if decoder.receive_frame(&mut decoded).is_ok() {
                let mut rgb_frame = Video::empty();
                scaler.run(&decoded, &mut rgb_frame)?;

                let width = rgb_frame.width();
                let height = rgb_frame.height();
                let stride = rgb_frame.stride(0);
                let pixel_width = (width * 3) as usize;

                let mut data = Vec::with_capacity((width * height * 3) as usize);
                for y in 0..height as usize {
                    let row_start = y * stride;
                    let row_end = row_start + pixel_width;
                    data.extend_from_slice(&rgb_frame.data(0)[row_start..row_end]);
                }

                return Ok(VideoFrame {
                    data,
                    width,
                    height,
                    pts: None,
                    time_base: (1, 1),
                });
            }
        }
    }

    Err(Error::Other("Failed to decode image".into()))
}

/// Check if a file path looks like an image (by extension).
pub fn is_image_path(path: &str) -> bool {
    let p = Path::new(path);
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "bmp" | "tiff" | "tif" | "webp")
    )
}
```

**Step 2: Export from lib.rs**

Add to `veha-core/src/lib.rs`:
```rust
pub mod image;
```

**Step 3: Update CLI to handle images**

Add image display logic to the `play` function in `veha-cli/src/main.rs` — detect image files and display them for a fixed duration (5 seconds default) or until window close:

In `veha-cli/src/main.rs`, update the `play` function to check `veha_core::image::is_image_path()` and call `veha_core::image::decode_image()` for image files, displaying the frame in the window until it's closed or 5 seconds elapse.

**Step 4: Build and test**

Run: `cargo build`
Expected: Compiles.

Run: `cargo run -- play test-image.png`
Expected: Window opens showing the image for 5 seconds then closes.

**Step 5: Commit**

```bash
git add veha-core/src/image.rs veha-core/src/lib.rs veha-cli/src/main.rs
git commit -m "feat(core): add image decoding support"
```

---

### Task 7: Playlist Data Model

**Files:**
- Create: `veha-core/src/playlist.rs`
- Modify: `veha-core/src/lib.rs`

**Step 1: Implement playlist types**

`veha-core/src/playlist.rs`:
```rust
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// A single item in a playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    /// File path or stream URL.
    pub source: String,

    /// How long to display (for images, or to limit video playback).
    /// If None for video, plays to end.
    pub duration: Option<Duration>,

    /// Optional human-readable name.
    pub name: Option<String>,
}

/// A playlist of media items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub name: String,
    pub items: Vec<MediaItem>,
    /// Whether to loop the playlist when it finishes.
    pub loop_playlist: bool,
}

impl Playlist {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            items: Vec::new(),
            loop_playlist: false,
        }
    }

    pub fn add(&mut self, item: MediaItem) {
        self.items.push(item);
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Load a playlist from a JSON file.
    pub fn from_json_file(path: &str) -> crate::Result<Self> {
        let data = std::fs::read_to_string(path)?;
        let playlist: Playlist =
            serde_json::from_str(&data).map_err(|e| crate::Error::Other(e.to_string()))?;
        Ok(playlist)
    }

    /// Save the playlist to a JSON file.
    pub fn to_json_file(&self, path: &str) -> crate::Result<()> {
        let data =
            serde_json::to_string_pretty(self).map_err(|e| crate::Error::Other(e.to_string()))?;
        std::fs::write(path, data)?;
        Ok(())
    }
}
```

**Step 2: Add serde + serde_json to workspace deps**

Add to workspace `Cargo.toml` `[workspace.dependencies]`:
```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Add to `veha-core/Cargo.toml` `[dependencies]`:
```toml
serde.workspace = true
serde_json.workspace = true
```

**Step 3: Export from lib.rs**

Add to `veha-core/src/lib.rs`:
```rust
pub mod playlist;
pub use playlist::{Playlist, MediaItem};
```

**Step 4: Build**

Run: `cargo build`
Expected: Compiles.

**Step 5: Commit**

```bash
git add veha-core/src/playlist.rs veha-core/src/lib.rs veha-core/Cargo.toml Cargo.toml
git commit -m "feat(core): add playlist data model with JSON serialization"
```

---

### Task 8: Playlist Player — Play Multiple Items in Sequence

**Files:**
- Create: `veha-core/src/player.rs`
- Modify: `veha-core/src/lib.rs`
- Modify: `veha-cli/src/main.rs`

**Step 1: Implement the Player**

`veha-core/src/player.rs`:
```rust
use std::thread;
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::decoder::Decoder;
use crate::frame::VideoFrame;
use crate::image;
use crate::playlist::{MediaItem, Playlist};
use crate::sink::OutputSink;
use crate::Result;

/// Player state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerState {
    Stopped,
    Playing,
    Paused,
}

/// Plays media items to an OutputSink.
pub struct Player {
    state: PlayerState,
}

impl Player {
    pub fn new() -> Self {
        Self {
            state: PlayerState::Stopped,
        }
    }

    pub fn state(&self) -> PlayerState {
        self.state
    }

    /// Play a single media item to the sink. Returns when the item finishes or the sink closes.
    pub fn play_item(&mut self, item: &MediaItem, sink: &mut dyn OutputSink) -> Result<()> {
        let (target_w, target_h) = sink.resolution();
        info!("Playing: {}", item.source);

        if image::is_image_path(&item.source) {
            self.play_image(item, sink, target_w, target_h)?;
        } else {
            self.play_video(item, sink, target_w, target_h)?;
        }

        Ok(())
    }

    /// Play an entire playlist.
    pub fn play_playlist(&mut self, playlist: &Playlist, sink: &mut dyn OutputSink) -> Result<()> {
        self.state = PlayerState::Playing;

        loop {
            for (i, item) in playlist.items.iter().enumerate() {
                if !sink.is_open() || self.state == PlayerState::Stopped {
                    self.state = PlayerState::Stopped;
                    return Ok(());
                }

                info!("Playlist item {}/{}: {}", i + 1, playlist.len(), item.source);
                if let Err(e) = self.play_item(item, sink) {
                    warn!("Error playing {}: {e}. Skipping.", item.source);
                }
            }

            if !playlist.loop_playlist {
                break;
            }
            info!("Looping playlist: {}", playlist.name);
        }

        self.state = PlayerState::Stopped;
        Ok(())
    }

    fn play_video(
        &mut self,
        item: &MediaItem,
        sink: &mut dyn OutputSink,
        target_w: u32,
        target_h: u32,
    ) -> Result<()> {
        let mut decoder = Decoder::open(&item.source, target_w, target_h)?;
        let fps = decoder.frame_rate().unwrap_or(30.0);
        let frame_duration = Duration::from_secs_f64(1.0 / fps);
        let playback_start = Instant::now();

        self.state = PlayerState::Playing;

        for frame_result in &mut decoder {
            if !sink.is_open() || self.state == PlayerState::Stopped {
                break;
            }

            // Check max duration.
            if let Some(max_dur) = item.duration {
                if playback_start.elapsed() >= max_dur {
                    break;
                }
            }

            let frame = frame_result?;
            let frame_start = Instant::now();
            sink.write_frame(&frame)?;

            let elapsed = frame_start.elapsed();
            if elapsed < frame_duration {
                thread::sleep(frame_duration - elapsed);
            }
        }

        Ok(())
    }

    fn play_image(
        &mut self,
        item: &MediaItem,
        sink: &mut dyn OutputSink,
        target_w: u32,
        target_h: u32,
    ) -> Result<()> {
        let frame = image::decode_image(&item.source, target_w, target_h)?;
        let display_duration = item.duration.unwrap_or(Duration::from_secs(5));
        let start = Instant::now();

        self.state = PlayerState::Playing;

        while sink.is_open() && start.elapsed() < display_duration {
            sink.write_frame(&frame)?;
            thread::sleep(Duration::from_millis(16)); // ~60fps refresh
        }

        Ok(())
    }
}
```

**Step 2: Export from lib.rs**

Add to `veha-core/src/lib.rs`:
```rust
pub mod player;
pub use player::{Player, PlayerState};
```

**Step 3: Update CLI to support playlists**

Add a `Playlist` subcommand to `veha-cli/src/main.rs`:
```rust
/// Play a JSON playlist file.
PlayPlaylist {
    /// Path to playlist JSON file.
    playlist: String,

    #[arg(long)]
    width: Option<u32>,

    #[arg(long)]
    height: Option<u32>,
},
```

**Step 4: Build and test**

Run: `cargo build`
Expected: Compiles.

Create a test playlist JSON:
```json
{
  "name": "test",
  "items": [
    {"source": "video1.mp4", "duration": null, "name": "Video 1"},
    {"source": "image.png", "duration": {"secs": 3, "nanos": 0}, "name": "Image"}
  ],
  "loop_playlist": false
}
```

Run: `cargo run -- play-playlist test-playlist.json`
Expected: Plays video, then shows image for 3 seconds, then exits.

**Step 5: Commit**

```bash
git add veha-core/src/player.rs veha-core/src/lib.rs veha-cli/src/main.rs
git commit -m "feat(core): add Player with playlist and sequential playback"
```

---

### Task 9: Null Sink for Testing

**Files:**
- Create: `veha-output/src/null.rs`
- Modify: `veha-output/src/lib.rs`
- Create: `veha-core/tests/decoder_test.rs`

**Step 1: Implement null sink**

`veha-output/src/null.rs`:
```rust
use veha_core::frame::VideoFrame;
use veha_core::sink::OutputSink;
use veha_core::Result;

/// A null output sink that discards frames. Useful for testing and benchmarking.
pub struct NullSink {
    width: u32,
    height: u32,
    frame_count: u64,
    open: bool,
    max_frames: Option<u64>,
}

impl NullSink {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            frame_count: 0,
            open: true,
            max_frames: None,
        }
    }

    /// Create a null sink that closes after N frames.
    pub fn with_max_frames(width: u32, height: u32, max: u64) -> Self {
        Self {
            width,
            height,
            frame_count: 0,
            open: true,
            max_frames: Some(max),
        }
    }

    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }
}

impl OutputSink for NullSink {
    fn write_frame(&mut self, _frame: &VideoFrame) -> Result<()> {
        self.frame_count += 1;
        if let Some(max) = self.max_frames {
            if self.frame_count >= max {
                self.open = false;
            }
        }
        Ok(())
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_open(&self) -> bool {
        self.open
    }
}
```

**Step 2: Export null sink**

Add to `veha-output/src/lib.rs`:
```rust
pub mod null;
pub use null::NullSink;
```

**Step 3: Build**

Run: `cargo build`
Expected: Compiles.

**Step 4: Commit**

```bash
git add veha-output/src/null.rs veha-output/src/lib.rs
git commit -m "feat(output): add NullSink for testing and benchmarking"
```

---

### Task 10: Integration Test with Test Media

**Files:**
- Create: `tests/integration_test.rs` (workspace-level test) OR `veha-cli/tests/playback_test.rs`

**Step 1: Create a test video using FFmpeg CLI**

Run:
```bash
ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -c:v libx264 -pix_fmt yuv420p tests/fixtures/test.mp4
```

This creates a 2-second 320x240 test video.

**Step 2: Write integration test**

Create `veha-core/tests/decoder_test.rs`:
```rust
use veha_core::{Decoder, OutputSink};

#[test]
fn test_decode_test_video() {
    veha_core::init();

    let decoder = Decoder::open_native("tests/fixtures/test.mp4").unwrap();
    let (w, h) = decoder.target_resolution();
    assert_eq!(w, 320);
    assert_eq!(h, 240);

    let mut frame_count = 0;
    for frame_result in decoder {
        let frame = frame_result.unwrap();
        assert_eq!(frame.width, 320);
        assert_eq!(frame.height, 240);
        assert_eq!(frame.data.len(), (320 * 240 * 3) as usize);
        frame_count += 1;
    }

    assert!(frame_count > 0, "Should have decoded at least one frame");
    println!("Decoded {frame_count} frames");
}
```

**Step 3: Run tests**

Run: `cargo test`
Expected: All tests pass.

**Step 4: Commit**

```bash
mkdir -p tests/fixtures
git add tests/ veha-core/tests/
git commit -m "test: add integration test for video decoding"
```

---

## Summary

| Task | Component | What it builds |
|------|-----------|---------------|
| 1 | Workspace | Cargo workspace structure with 3 crates |
| 2 | veha-core | VideoFrame type + OutputSink trait |
| 3 | veha-core | Video decoder (FFmpeg demux + decode + scale) |
| 4 | veha-output | Window output backend (minifb) |
| 5 | veha-cli | CLI `play` command — video in window |
| 6 | veha-core | Image decoding support |
| 7 | veha-core | Playlist data model (JSON) |
| 8 | veha-core | Player with sequential playlist playback |
| 9 | veha-output | Null sink for testing |
| 10 | tests | Integration test with test video |

After completing these 10 tasks, you will have a working media player that can:
- Decode video files and streams to RGB frames
- Display them in a desktop window with frame-rate pacing
- Decode and display images with configurable duration
- Play playlists (sequences of videos and images)
- Load/save playlists as JSON
- Run headlessly with a null sink for testing
