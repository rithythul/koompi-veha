pub mod audio;
pub mod command;
pub mod decoder;
pub mod error;
pub mod frame;
pub mod image;
pub mod player;
pub mod playlist;
pub mod sink;

pub use decoder::Decoder;
pub use error::Error;
pub use frame::VideoFrame;
pub use player::{Player, PlayerState};
pub use playlist::{MediaItem, Playlist};
pub use command::SystemMetrics;
pub use sink::{OutputSink, SinkEvent, SinkKey};

pub type Result<T> = std::result::Result<T, Error>;

use std::sync::OnceLock;

static INIT: OnceLock<std::result::Result<(), String>> = OnceLock::new();

/// Initialize FFmpeg. Call once at program start.
/// Safe to call multiple times — only the first call has effect.
/// Returns the same result on every call (caches first attempt).
pub fn init() -> Result<()> {
    INIT.get_or_init(|| {
        ffmpeg_next::init().map_err(|e| e.to_string())
    })
    .as_ref()
    .map(|_| ())
    .map_err(|e| Error::Other(format!("FFmpeg init failed: {e}")))
}
