use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeConfig {
    // Board identity
    pub board_id: String,

    #[serde(default = "default_name")]
    pub board_name: String,

    // API connection
    pub api_url: String,

    #[serde(default)]
    pub api_key: String,

    // Player output
    #[serde(default = "default_backend")]
    pub output_backend: String,

    #[serde(default = "default_width")]
    pub width: u32,

    #[serde(default = "default_height")]
    pub height: u32,

    #[serde(default = "default_fullscreen")]
    pub fullscreen: bool,

    // Runtime paths
    #[serde(default = "default_socket")]
    pub player_socket: String,

    #[serde(default = "default_cache_dir")]
    pub cache_dir: String,

    // Timing
    #[serde(default = "default_report_interval")]
    pub report_interval_secs: u64,

    #[serde(default = "default_screenshot_interval")]
    pub screenshot_interval_secs: u64,

    #[serde(default = "default_restart_delay")]
    pub player_restart_delay_secs: u64,
}

fn default_name() -> String {
    "unnamed-board".into()
}
fn default_backend() -> String {
    "framebuffer".into()
}
fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}
fn default_fullscreen() -> bool {
    true
}
fn default_socket() -> String {
    "/run/veha/player.sock".into()
}
fn default_cache_dir() -> String {
    "/var/cache/veha".into()
}
fn default_report_interval() -> u64 {
    10
}
fn default_screenshot_interval() -> u64 {
    60
}
fn default_restart_delay() -> u64 {
    5
}

impl EdgeConfig {
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&content)?)
    }
}

impl From<&EdgeConfig> for veha_agent::AgentConfig {
    fn from(c: &EdgeConfig) -> Self {
        Self {
            board_id: c.board_id.clone(),
            board_name: c.board_name.clone(),
            api_url: c.api_url.clone(),
            api_key: c.api_key.clone(),
            player_socket: c.player_socket.clone(),
            cache_dir: c.cache_dir.clone(),
            report_interval_secs: c.report_interval_secs,
            screenshot_interval_secs: c.screenshot_interval_secs,
        }
    }
}

impl From<&EdgeConfig> for veha_player::PlayerConfig {
    fn from(c: &EdgeConfig) -> Self {
        Self {
            output_backend: c.output_backend.clone(),
            width: c.width,
            height: c.height,
            fullscreen: c.fullscreen,
            socket_path: c.player_socket.clone(),
            title: "veha-edge".into(),
            default_playlist: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edge_config_defaults() {
        let toml = r#"
board_id = "board-001"
api_url = "ws://192.168.1.17:3000/ws/agent"
"#;
        let cfg: EdgeConfig = toml::from_str(toml).unwrap();
        assert_eq!(cfg.board_id, "board-001");
        assert_eq!(cfg.output_backend, "framebuffer");
        assert_eq!(cfg.width, 1920);
        assert_eq!(cfg.height, 1080);
        assert_eq!(cfg.report_interval_secs, 10);
        assert_eq!(cfg.screenshot_interval_secs, 60);
        assert_eq!(cfg.player_restart_delay_secs, 5);
        assert_eq!(cfg.player_socket, "/run/veha/player.sock");
    }

    #[test]
    fn test_to_agent_config() {
        let toml = r#"
board_id = "b1"
api_url = "ws://localhost:3000/ws/agent"
board_name = "Test Board"
api_key = "secret"
"#;
        let cfg: EdgeConfig = toml::from_str(toml).unwrap();
        let agent = veha_agent::AgentConfig::from(&cfg);
        assert_eq!(agent.board_id, "b1");
        assert_eq!(agent.board_name, "Test Board");
        assert_eq!(agent.api_key, "secret");
        assert_eq!(agent.player_socket, cfg.player_socket);
    }

    #[test]
    fn test_to_player_config() {
        let toml = r#"
board_id = "b1"
api_url = "ws://localhost:3000/ws/agent"
output_backend = "null"
width = 1280
height = 720
"#;
        let cfg: EdgeConfig = toml::from_str(toml).unwrap();
        let player = veha_player::PlayerConfig::from(&cfg);
        assert_eq!(player.output_backend, "null");
        assert_eq!(player.width, 1280);
        assert_eq!(player.height, 720);
        assert_eq!(player.socket_path, cfg.player_socket);
    }
}
