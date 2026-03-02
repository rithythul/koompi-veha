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
    // veha extensions
    pub zone_id: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub address: Option<String>,
    pub board_type: Option<String>,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
    pub orientation: Option<String>,
    pub sell_mode: Option<String>,
    pub operating_hours_start: Option<String>,
    pub operating_hours_end: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateBoard {
    pub name: Option<String>,
    pub group_id: Option<Option<String>>,
    pub zone_id: Option<Option<String>>,
    pub latitude: Option<Option<f64>>,
    pub longitude: Option<Option<f64>>,
    pub address: Option<Option<String>>,
    pub board_type: Option<String>,
    pub screen_width: Option<Option<i32>>,
    pub screen_height: Option<Option<i32>>,
    pub orientation: Option<String>,
    pub sell_mode: Option<String>,
    pub operating_hours_start: Option<Option<String>>,
    pub operating_hours_end: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BoardFilter {
    pub zone_id: Option<String>,
    pub sell_mode: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBoard {
    pub name: String,
    pub group_id: Option<String>,
    pub zone_id: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub address: Option<String>,
    pub board_type: Option<String>,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
    pub orientation: Option<String>,
    pub sell_mode: Option<String>,
    pub operating_hours_start: Option<String>,
    pub operating_hours_end: Option<String>,
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
    pub items: Vec<veha_core::MediaItem>,
    #[serde(default)]
    pub loop_playlist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistResponse {
    pub id: String,
    pub name: String,
    pub items: Vec<veha_core::MediaItem>,
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
    pub command: veha_core::command::PlayerCommand,
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

#[derive(Debug, Clone, Deserialize)]
pub struct CreateUser {
    pub username: String,
    pub password: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUser {
    pub username: Option<String>,
    pub role: Option<String>,
    pub password: Option<String>,
}

// ── veha Models ───────────────────────────────────────────────────────

// ── Zones ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Zone {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub zone_type: String,
    pub rate_per_slot: Option<f64>,
    pub currency: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateZone {
    pub name: String,
    pub parent_id: Option<String>,
    #[serde(default = "default_zone_type")]
    pub zone_type: String,
    pub rate_per_slot: Option<f64>,
    pub currency: Option<String>,
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
    pub budget: Option<f64>,
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
    pub budget: Option<f64>,
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
    pub approval_status: Option<String>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCreative {
    pub media_id: String,
    pub name: Option<String>,
    pub duration_secs: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCreative {
    pub media_id: String,
    pub name: Option<String>,
    pub duration_secs: Option<i32>,
    pub status: Option<String>,
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
    pub cost_per_slot: Option<f64>,
    pub estimated_cost: Option<f64>,
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

// ── Play Logs ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlayLog {
    pub id: String,
    pub board_id: String,
    pub booking_id: Option<String>,
    pub creative_id: Option<String>,
    pub media_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_secs: Option<i32>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlayLogFilter {
    pub board_id: Option<String>,
    pub booking_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PlayLogSummary {
    pub date: String,
    pub board_id: String,
    pub booking_id: Option<String>,
    pub play_count: i64,
    pub total_duration_secs: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlayLogSummaryFilter {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

// ── Board Alerts ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BoardAlert {
    pub id: String,
    pub board_id: Option<String>,
    pub alert_type: String,
    pub severity: String,
    pub message: String,
    pub acknowledged: bool,
    pub created_at: String,
    pub acknowledged_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlertFilter {
    pub acknowledged: Option<bool>,
    pub alert_type: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertCount {
    pub count: i64,
}

// ── API Keys ──

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiKey {
    pub id: String,
    pub user_id: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub preview: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyCreated {
    pub id: String,
    pub name: String,
    pub key: String,
    pub preview: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateApiKey {
    pub name: String,
}

// ── Campaign Performance ──

#[derive(Debug, Clone, Serialize)]
pub struct CampaignPerformance {
    pub campaign_id: String,
    pub total_plays: i64,
    pub total_duration_secs: i64,
    pub estimated_reach: i64,
    pub cost_per_play: Option<f64>,
    pub budget_utilization: Option<f64>,
    pub total_estimated_cost: f64,
    pub budget: Option<f64>,
}

// ── Revenue Reports ──

#[derive(Debug, Clone, Deserialize)]
pub struct RevenueReportFilter {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub group_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RevenueRow {
    pub group_key: String,
    pub group_name: String,
    pub total_cost: f64,
    pub booking_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RevenueReport {
    pub rows: Vec<RevenueRow>,
    pub total: f64,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub group_by: String,
}
