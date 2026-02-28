use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Unique board identifier
    pub board_id: String,

    /// Display name for this board
    #[serde(default = "default_name")]
    pub board_name: String,

    /// API server WebSocket URL (e.g. ws://api-server:3000/ws/agent)
    pub api_url: String,

    /// API key for authentication
    #[serde(default)]
    pub api_key: String,

    /// Path to local mepl-player Unix socket
    #[serde(default = "default_socket")]
    pub player_socket: String,

    /// Status report interval in seconds
    #[serde(default = "default_interval")]
    pub report_interval_secs: u64,

    /// Media cache directory
    #[serde(default = "default_cache_dir")]
    pub cache_dir: String,
}

fn default_name() -> String {
    "unnamed-board".into()
}
fn default_socket() -> String {
    "/tmp/mepl-player.sock".into()
}
fn default_interval() -> u64 {
    10
}
fn default_cache_dir() -> String {
    "/tmp/mepl-cache".into()
}

impl AgentConfig {
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: AgentConfig = toml::from_str(&content)?;
        Ok(config)
    }
}
