use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerConfig {
    /// Output backend: "window", "framebuffer", "null"
    #[serde(default = "default_backend")]
    pub output_backend: String,

    /// Target resolution width
    #[serde(default = "default_width")]
    pub width: u32,

    /// Target resolution height
    #[serde(default = "default_height")]
    pub height: u32,

    /// Path to default playlist JSON file
    pub default_playlist: Option<String>,

    /// Unix socket path for IPC
    #[serde(default = "default_socket_path")]
    pub socket_path: String,

    /// Window title (for window backend)
    #[serde(default = "default_title")]
    pub title: String,
}

fn default_backend() -> String {
    "window".into()
}
fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}
fn default_socket_path() -> String {
    "/tmp/dooh-player.sock".into()
}
fn default_title() -> String {
    "dooh-player".into()
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            output_backend: default_backend(),
            width: default_width(),
            height: default_height(),
            default_playlist: None,
            socket_path: default_socket_path(),
            title: default_title(),
        }
    }
}

impl PlayerConfig {
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: PlayerConfig = toml::from_str(&content)?;
        Ok(config)
    }
}
