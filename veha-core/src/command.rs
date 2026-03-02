use serde::{Deserialize, Serialize};

/// Commands that can be sent to control the player.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum PlayerCommand {
    Play,
    Pause,
    Resume,
    Stop,
    /// Skip to next item in playlist.
    Next,
    /// Skip to previous item in playlist.
    Previous,
    /// Load a new playlist from a JSON string.
    LoadPlaylist(String),
    /// Get current player status.
    GetStatus,
    /// Take a screenshot and save to the given file path.
    TakeScreenshot(String),
    /// Seek to absolute position in seconds.
    Seek(f64),
    /// Seek relative to current position (+/- seconds).
    SeekRelative(f64),
    /// Set volume (0.0 to 1.0).
    SetVolume(f32),
    /// Toggle mute.
    Mute,
    /// Set playback speed (0.25 to 4.0).
    SetSpeed(f32),
    /// Toggle fullscreen mode.
    ToggleFullscreen,
}

/// Status response from the player.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStatus {
    pub state: String,
    pub current_item: Option<String>,
    pub current_index: usize,
    pub total_items: usize,
    pub playlist_name: Option<String>,
    #[serde(default)]
    pub active_booking_id: Option<String>,
    #[serde(default)]
    pub active_creative_id: Option<String>,
    #[serde(default)]
    pub active_media_id: Option<String>,
    #[serde(default)]
    pub uptime_secs: Option<u64>,
    #[serde(default)]
    pub position_secs: Option<f64>,
    #[serde(default)]
    pub duration_secs: Option<f64>,
    #[serde(default = "default_volume")]
    pub volume: f32,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default = "default_speed")]
    pub playback_speed: f32,
    #[serde(default)]
    pub is_fullscreen: bool,
}

fn default_volume() -> f32 {
    1.0
}
fn default_speed() -> f32 {
    1.0
}
