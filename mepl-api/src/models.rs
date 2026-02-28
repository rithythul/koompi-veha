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

// ── Auth Models ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: String,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            role: u.role,
            created_at: u.created_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

// ── DOOH Models ───────────────────────────────────────────────────────

// ── Zones ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Zone {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub zone_type: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateZone {
    pub name: String,
    pub parent_id: Option<String>,
    #[serde(default = "default_zone_type")]
    pub zone_type: String,
}

fn default_zone_type() -> String {
    "custom".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneDetail {
    #[serde(flatten)]
    pub zone: Zone,
    pub children: Vec<Zone>,
    pub board_count: i64,
}

// ── Advertisers ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Advertiser {
    pub id: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub is_house: bool,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAdvertiser {
    pub name: String,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub notes: Option<String>,
}

// ── Campaigns ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Campaign {
    pub id: String,
    pub advertiser_id: String,
    pub name: String,
    pub status: String,
    pub start_date: String,
    pub end_date: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCampaign {
    pub advertiser_id: String,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignFilter {
    pub advertiser_id: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

// ── Creatives ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Creative {
    pub id: String,
    pub campaign_id: String,
    pub media_id: String,
    pub name: Option<String>,
    pub duration_secs: Option<i32>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCreative {
    pub media_id: String,
    pub name: Option<String>,
    pub duration_secs: Option<i32>,
}

// ── Bookings ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Booking {
    pub id: String,
    pub campaign_id: String,
    pub booking_type: String,
    pub target_type: String,
    pub target_id: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub days_of_week: String,
    pub slot_duration_secs: i32,
    pub slots_per_loop: i32,
    pub priority: i32,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBooking {
    pub campaign_id: String,
    pub booking_type: String,
    pub target_type: String,
    pub target_id: String,
    pub start_date: String,
    pub end_date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub days_of_week: Option<String>,
    pub slot_duration_secs: Option<i32>,
    pub slots_per_loop: Option<i32>,
    pub priority: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingFilter {
    pub campaign_id: Option<String>,
    pub target_type: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}
