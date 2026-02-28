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

    #[error("JSON parse error: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Invalid dimensions: {0}")]
    InvalidDimensions(String),

    #[error("Image decode failed: {0}")]
    ImageDecode(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("{0}")]
    Other(String),
}
