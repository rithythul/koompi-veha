pub mod error;

pub use error::Error;
pub type Result<T> = std::result::Result<T, Error>;

/// Initialize FFmpeg. Call once at program start.
pub fn init() {
    ffmpeg_next::init().expect("Failed to initialize FFmpeg");
}
