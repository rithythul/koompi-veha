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
pub use sink::OutputSink;

pub type Result<T> = std::result::Result<T, Error>;

/// Initialize FFmpeg. Call once at program start.
pub fn init() {
    ffmpeg_next::init().expect("Failed to initialize FFmpeg");
}
