use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub status: String,
    pub last_seen: Option<String>,
    pub config: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBoard {
    pub name: String,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGroup {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Media {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaylistRow {
    pub id: String,
    pub name: String,
    pub items: String,
    pub loop_playlist: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylist {
    pub name: String,
    pub items: Vec<mepl_core::MediaItem>,
    #[serde(default)]
    pub loop_playlist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistResponse {
    pub id: String,
    pub name: String,
    pub items: Vec<mepl_core::MediaItem>,
    pub loop_playlist: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Schedule {
    pub id: String,
    pub board_id: Option<String>,
    pub group_id: Option<String>,
    pub playlist_id: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub days_of_week: String,
    pub priority: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSchedule {
    pub board_id: Option<String>,
    pub group_id: Option<String>,
    pub playlist_id: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub days_of_week: Option<String>,
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRequest {
    pub command: mepl_core::command::PlayerCommand,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

fn default_page() -> u32 { 1 }
fn default_per_page() -> u32 { 50 }

#[derive(Debug, Clone, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}
