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
