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
}
