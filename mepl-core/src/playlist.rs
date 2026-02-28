use std::time::Duration;

use serde::{Deserialize, Serialize};

/// A single item in a playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub source: String,
    pub duration: Option<Duration>,
    pub name: Option<String>,
}

/// A playlist of media items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub name: String,
    pub items: Vec<MediaItem>,
    pub loop_playlist: bool,
}

impl Playlist {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            items: Vec::new(),
            loop_playlist: false,
        }
    }

    pub fn add(&mut self, item: MediaItem) {
        self.items.push(item);
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn from_json_file(path: &str) -> crate::Result<Self> {
        let metadata = std::fs::metadata(path)?;
        if metadata.len() > 10 * 1024 * 1024 {  // 10MB max
            return Err(crate::Error::Other(
                format!("Playlist file too large: {} bytes", metadata.len())
            ));
        }
        let data = std::fs::read_to_string(path)?;
        let playlist: Playlist = serde_json::from_str(&data)?;
        Ok(playlist)
    }

    pub fn to_json_file(&self, path: &str) -> crate::Result<()> {
        let data = serde_json::to_string_pretty(self)?;
        let tmp_path = format!("{}.tmp", path);
        std::fs::write(&tmp_path, &data)?;
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    }
}
