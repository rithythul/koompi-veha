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
