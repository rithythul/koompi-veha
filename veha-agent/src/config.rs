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

    /// Path to local veha-player Unix socket
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
    "/tmp/veha-player.sock".into()
}
fn default_interval() -> u64 {
    10
}
fn default_cache_dir() -> String {
    "/tmp/veha-cache".into()
}

impl AgentConfig {
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: AgentConfig = toml::from_str(&content)?;
        Ok(config)
    }

    /// Derive the HTTP base URL from the WebSocket `api_url`.
    ///
    /// `ws://host:3000/ws/agent` → `http://host:3000`
    /// `wss://host/ws/agent`     → `https://host`
    pub fn api_base_url(&self) -> String {
        let url = self
            .api_url
            .replace("wss://", "https://")
            .replace("ws://", "http://");
        // Strip path component (everything from the first '/' after the host)
        match url.find("://") {
            Some(i) => match url[i + 3..].find('/') {
                Some(j) => url[..i + 3 + j].to_string(),
                None => url,
            },
            None => url,
        }
    }
}
