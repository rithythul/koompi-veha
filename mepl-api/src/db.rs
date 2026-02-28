use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use uuid::Uuid;

use crate::models::*;

const MIGRATION_SQL: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002_SQL: &str = include_str!("../migrations/002_indexes.sql");
const MIGRATION_003_SQL: &str = include_str!("../migrations/003_dooh.sql");
const MIGRATION_003B_SQL: &str = include_str!("../migrations/003b_board_extensions.sql");

/// Initialize the database pool and run migrations.
pub async fn init_db(path: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let url = format!("sqlite:{}?mode=rwc", path);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await?;

    // Enable WAL mode for better concurrent reads
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;

    // Run migrations: split by statement and execute each
    for statement in MIGRATION_SQL.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await?;
        }
    }

    // Run index migration
    for statement in MIGRATION_002_SQL.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await?;
        }
    }

    // Run DOOH migration (003) — check if zones table already exists
    let zones_exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='zones'",
    )
    .fetch_one(&pool)
    .await?;

    if zones_exists.0 == 0 {
        for statement in MIGRATION_003_SQL.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() {
                sqlx::query(trimmed).execute(&pool).await?;
            }
        }
        tracing::info!("DOOH migration (003) applied");
    }

    // Run board extensions migration (003b) — check if zone_id column exists on boards
    let zone_col_exists: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM pragma_table_info('boards') WHERE name='zone_id'",
    )
    .fetch_one(&pool)
    .await?;

    if zone_col_exists.0 == 0 {
        for statement in MIGRATION_003B_SQL.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() {
                sqlx::query(trimmed).execute(&pool).await?;
            }
        }
        tracing::info!("Board extensions migration (003b) applied");
    }

    tracing::info!("Database initialized at {}", path);
    Ok(pool)
}

// ── Boards ──────────────────────────────────────────────────────────────

pub async fn list_boards(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Board>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM boards")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let boards = sqlx::query_as::<_, Board>(
        "SELECT id, name, group_id, status, last_seen, config, created_at FROM boards ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((boards, total.0))
}

pub async fn get_board(pool: &SqlitePool, id: &str) -> Result<Option<Board>, sqlx::Error> {
    sqlx::query_as::<_, Board>("SELECT id, name, group_id, status, last_seen, config, created_at FROM boards WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_board(pool: &SqlitePool, input: &CreateBoard) -> Result<Board, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO boards (id, name, group_id) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&input.name)
        .bind(&input.group_id)
        .execute(pool)
        .await?;
    get_board(pool, &id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_board_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE boards SET status = ?, last_seen = datetime('now') WHERE id = ?")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Ensure a board row exists (upsert on agent registration).
pub async fn upsert_board(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO boards (id, name, status, last_seen) VALUES (?, ?, 'online', datetime('now'))
         ON CONFLICT(id) DO UPDATE SET status = 'online', last_seen = datetime('now')",
    )
    .bind(id)
    .bind(id) // default name = id
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_boards_by_group(
    pool: &SqlitePool,
    group_id: &str,
) -> Result<Vec<Board>, sqlx::Error> {
    sqlx::query_as::<_, Board>(
        "SELECT id, name, group_id, status, last_seen, config, created_at FROM boards WHERE group_id = ?",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await
}

// ── Groups ──────────────────────────────────────────────────────────────

pub async fn list_groups(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Group>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM groups")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let groups = sqlx::query_as::<_, Group>(
        "SELECT id, name, created_at FROM groups ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((groups, total.0))
}

pub async fn get_group(pool: &SqlitePool, id: &str) -> Result<Option<Group>, sqlx::Error> {
    sqlx::query_as::<_, Group>("SELECT id, name, created_at FROM groups WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_group(pool: &SqlitePool, input: &CreateGroup) -> Result<Group, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO groups (id, name) VALUES (?, ?)")
        .bind(&id)
        .bind(&input.name)
        .execute(pool)
        .await?;
    get_group(pool, &id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn delete_group(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM groups WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Media ───────────────────────────────────────────────────────────────

pub async fn list_media(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Media>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM media")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let media = sqlx::query_as::<_, Media>(
        "SELECT id, name, filename, mime_type, size, uploaded_at FROM media ORDER BY uploaded_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((media, total.0))
}

pub async fn get_media(pool: &SqlitePool, id: &str) -> Result<Option<Media>, sqlx::Error> {
    sqlx::query_as::<_, Media>(
        "SELECT id, name, filename, mime_type, size, uploaded_at FROM media WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_media(pool: &SqlitePool, media: &Media) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO media (id, name, filename, mime_type, size) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&media.id)
    .bind(&media.name)
    .bind(&media.filename)
    .bind(&media.mime_type)
    .bind(media.size)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_media(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM media WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Playlists ───────────────────────────────────────────────────────────

pub async fn list_playlists(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<PlaylistRow>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let rows = sqlx::query_as::<_, PlaylistRow>(
        "SELECT id, name, items, loop_playlist, created_at, updated_at FROM playlists ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((rows, total.0))
}

pub async fn get_playlist(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<PlaylistRow>, sqlx::Error> {
    sqlx::query_as::<_, PlaylistRow>(
        "SELECT id, name, items, loop_playlist, created_at, updated_at FROM playlists WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_playlist(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    items_json: &str,
    loop_playlist: bool,
) -> Result<PlaylistRow, sqlx::Error> {
    sqlx::query(
        "INSERT INTO playlists (id, name, items, loop_playlist) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(items_json)
    .bind(loop_playlist)
    .execute(pool)
    .await?;
    get_playlist(pool, id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_playlist(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    items_json: &str,
    loop_playlist: bool,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE playlists SET name = ?, items = ?, loop_playlist = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(name)
    .bind(items_json)
    .bind(loop_playlist)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_playlist(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlists WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Schedules ───────────────────────────────────────────────────────────

pub async fn list_schedules(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Schedule>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM schedules")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let schedules = sqlx::query_as::<_, Schedule>(
        "SELECT id, board_id, group_id, playlist_id, start_time, end_time, days_of_week, priority, created_at FROM schedules ORDER BY priority DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((schedules, total.0))
}

pub async fn create_schedule(
    pool: &SqlitePool,
    input: &CreateSchedule,
) -> Result<Schedule, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let days = input
        .days_of_week
        .clone()
        .unwrap_or_else(|| "0,1,2,3,4,5,6".to_string());
    let priority = input.priority.unwrap_or(0);

    sqlx::query(
        "INSERT INTO schedules (id, board_id, group_id, playlist_id, start_time, end_time, days_of_week, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.board_id)
    .bind(&input.group_id)
    .bind(&input.playlist_id)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&days)
    .bind(priority)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, Schedule>(
        "SELECT id, board_id, group_id, playlist_id, start_time, end_time, days_of_week, priority, created_at FROM schedules WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
}

pub async fn delete_schedule(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM schedules WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Auth ───────────────────────────────────────────────────────────────

pub async fn get_user_by_username(
    pool: &SqlitePool,
    username: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
}

pub async fn create_user(
    pool: &SqlitePool,
    id: &str,
    username: &str,
    password_hash: &str,
    role: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(username)
        .bind(password_hash)
        .bind(role)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn user_count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

pub async fn create_session(
    pool: &SqlitePool,
    id: &str,
    user_id: &str,
    expires_at: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(id)
        .bind(user_id)
        .bind(expires_at)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_valid_session(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT u.id, u.username, u.password_hash, u.role, u.created_at \
         FROM sessions s JOIN users u ON s.user_id = u.id \
         WHERE s.id = ? AND s.expires_at > datetime('now')",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_session(pool: &SqlitePool, session_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn cleanup_expired_sessions(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

// ── Zones ───────────────────────────────────────────────────────────────

pub async fn list_zones(pool: &SqlitePool) -> Result<Vec<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>(
        "SELECT id, name, parent_id, zone_type, created_at FROM zones ORDER BY name"
    )
    .fetch_all(pool)
    .await
}

pub async fn get_zone(pool: &SqlitePool, id: &str) -> Result<Option<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>(
        "SELECT id, name, parent_id, zone_type, created_at FROM zones WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_zone_children(pool: &SqlitePool, parent_id: &str) -> Result<Vec<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>(
        "SELECT id, name, parent_id, zone_type, created_at FROM zones WHERE parent_id = ? ORDER BY name"
    )
    .bind(parent_id)
    .fetch_all(pool)
    .await
}

pub async fn get_zone_board_count(pool: &SqlitePool, zone_id: &str) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM boards WHERE zone_id = ?"
    )
    .bind(zone_id)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn create_zone(pool: &SqlitePool, input: &CreateZone) -> Result<Zone, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO zones (id, name, parent_id, zone_type) VALUES (?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(&input.zone_type)
    .execute(pool)
    .await?;
    get_zone(pool, &id).await?.ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_zone(pool: &SqlitePool, id: &str, input: &CreateZone) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE zones SET name = ?, parent_id = ?, zone_type = ? WHERE id = ?"
    )
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(&input.zone_type)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_zone(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM zones WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Advertisers ─────────────────────────────────────────────────────────

pub async fn list_advertisers(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Advertiser>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM advertisers")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let items = sqlx::query_as::<_, Advertiser>(
        "SELECT id, name, contact_name, contact_email, contact_phone, is_house, notes, created_at \
         FROM advertisers ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((items, total.0))
}

pub async fn get_advertiser(pool: &SqlitePool, id: &str) -> Result<Option<Advertiser>, sqlx::Error> {
    sqlx::query_as::<_, Advertiser>(
        "SELECT id, name, contact_name, contact_email, contact_phone, is_house, notes, created_at \
         FROM advertisers WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_advertiser(pool: &SqlitePool, input: &CreateAdvertiser) -> Result<Advertiser, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO advertisers (id, name, contact_name, contact_email, contact_phone, notes) \
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.contact_name)
    .bind(&input.contact_email)
    .bind(&input.contact_phone)
    .bind(&input.notes)
    .execute(pool)
    .await?;
    get_advertiser(pool, &id).await?.ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_advertiser(pool: &SqlitePool, id: &str, input: &CreateAdvertiser) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE advertisers SET name = ?, contact_name = ?, contact_email = ?, contact_phone = ?, notes = ? \
         WHERE id = ?"
    )
    .bind(&input.name)
    .bind(&input.contact_name)
    .bind(&input.contact_email)
    .bind(&input.contact_phone)
    .bind(&input.notes)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_advertiser(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM advertisers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Campaigns ───────────────────────────────────────────────────────────

pub async fn list_campaigns(pool: &SqlitePool, filter: &CampaignFilter) -> Result<(Vec<Campaign>, i64), sqlx::Error> {
    let offset = ((filter.page.max(1) - 1) * filter.per_page) as i64;
    let limit = filter.per_page.min(200) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM campaigns WHERE \
         (? IS NULL OR advertiser_id = ?) AND \
         (? IS NULL OR status = ?)"
    )
    .bind(&filter.advertiser_id).bind(&filter.advertiser_id)
    .bind(&filter.status).bind(&filter.status)
    .fetch_one(pool)
    .await?;

    let items = sqlx::query_as::<_, Campaign>(
        "SELECT id, advertiser_id, name, status, start_date, end_date, notes, created_at, updated_at \
         FROM campaigns WHERE \
         (? IS NULL OR advertiser_id = ?) AND \
         (? IS NULL OR status = ?) \
         ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(&filter.advertiser_id).bind(&filter.advertiser_id)
    .bind(&filter.status).bind(&filter.status)
    .bind(limit).bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((items, total.0))
}

pub async fn get_campaign(pool: &SqlitePool, id: &str) -> Result<Option<Campaign>, sqlx::Error> {
    sqlx::query_as::<_, Campaign>(
        "SELECT id, advertiser_id, name, status, start_date, end_date, notes, created_at, updated_at \
         FROM campaigns WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_campaign(pool: &SqlitePool, input: &CreateCampaign) -> Result<Campaign, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO campaigns (id, advertiser_id, name, start_date, end_date, notes) \
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.advertiser_id)
    .bind(&input.name)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(&input.notes)
    .execute(pool)
    .await?;
    get_campaign(pool, &id).await?.ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_campaign(pool: &SqlitePool, id: &str, input: &CreateCampaign) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE campaigns SET advertiser_id = ?, name = ?, start_date = ?, end_date = ?, notes = ?, \
         updated_at = datetime('now') WHERE id = ?"
    )
    .bind(&input.advertiser_id)
    .bind(&input.name)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(&input.notes)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_campaign(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM campaigns WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn activate_campaign(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE campaigns SET status = 'active', updated_at = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn pause_campaign(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE campaigns SET status = 'paused', updated_at = datetime('now') WHERE id = ?"
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// ── Creatives ───────────────────────────────────────────────────────────

pub async fn list_creatives_by_campaign(pool: &SqlitePool, campaign_id: &str) -> Result<Vec<Creative>, sqlx::Error> {
    sqlx::query_as::<_, Creative>(
        "SELECT id, campaign_id, media_id, name, duration_secs, status, created_at \
         FROM creatives WHERE campaign_id = ? ORDER BY created_at"
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await
}

pub async fn create_creative(pool: &SqlitePool, campaign_id: &str, input: &CreateCreative) -> Result<Creative, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO creatives (id, campaign_id, media_id, name, duration_secs) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(campaign_id)
    .bind(&input.media_id)
    .bind(&input.name)
    .bind(input.duration_secs)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, Creative>(
        "SELECT id, campaign_id, media_id, name, duration_secs, status, created_at \
         FROM creatives WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(pool)
    .await
}

pub async fn delete_creative(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM creatives WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Bookings ────────────────────────────────────────────────────────────

pub async fn list_bookings(pool: &SqlitePool, filter: &BookingFilter) -> Result<(Vec<Booking>, i64), sqlx::Error> {
    let offset = ((filter.page.max(1) - 1) * filter.per_page) as i64;
    let limit = filter.per_page.min(200) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM bookings WHERE \
         (? IS NULL OR campaign_id = ?) AND \
         (? IS NULL OR target_type = ?) AND \
         (? IS NULL OR status = ?)"
    )
    .bind(&filter.campaign_id).bind(&filter.campaign_id)
    .bind(&filter.target_type).bind(&filter.target_type)
    .bind(&filter.status).bind(&filter.status)
    .fetch_one(pool)
    .await?;

    let items = sqlx::query_as::<_, Booking>(
        "SELECT id, campaign_id, booking_type, target_type, target_id, start_date, end_date, \
         start_time, end_time, days_of_week, slot_duration_secs, slots_per_loop, priority, \
         status, notes, created_at, updated_at \
         FROM bookings WHERE \
         (? IS NULL OR campaign_id = ?) AND \
         (? IS NULL OR target_type = ?) AND \
         (? IS NULL OR status = ?) \
         ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(&filter.campaign_id).bind(&filter.campaign_id)
    .bind(&filter.target_type).bind(&filter.target_type)
    .bind(&filter.status).bind(&filter.status)
    .bind(limit).bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((items, total.0))
}

pub async fn get_booking(pool: &SqlitePool, id: &str) -> Result<Option<Booking>, sqlx::Error> {
    sqlx::query_as::<_, Booking>(
        "SELECT id, campaign_id, booking_type, target_type, target_id, start_date, end_date, \
         start_time, end_time, days_of_week, slot_duration_secs, slots_per_loop, priority, \
         status, notes, created_at, updated_at \
         FROM bookings WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_booking(pool: &SqlitePool, input: &CreateBooking) -> Result<Booking, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let days = input.days_of_week.clone().unwrap_or_else(|| "0,1,2,3,4,5,6".to_string());
    let slot_duration = input.slot_duration_secs.unwrap_or(15);
    let slots_per_loop = input.slots_per_loop.unwrap_or(1);
    let priority = input.priority.unwrap_or(0);

    sqlx::query(
        "INSERT INTO bookings (id, campaign_id, booking_type, target_type, target_id, \
         start_date, end_date, start_time, end_time, days_of_week, slot_duration_secs, \
         slots_per_loop, priority, notes) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.campaign_id)
    .bind(&input.booking_type)
    .bind(&input.target_type)
    .bind(&input.target_id)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&days)
    .bind(slot_duration)
    .bind(slots_per_loop)
    .bind(priority)
    .bind(&input.notes)
    .execute(pool)
    .await?;

    get_booking(pool, &id).await?.ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn update_booking(pool: &SqlitePool, id: &str, input: &CreateBooking) -> Result<bool, sqlx::Error> {
    let days = input.days_of_week.clone().unwrap_or_else(|| "0,1,2,3,4,5,6".to_string());
    let slot_duration = input.slot_duration_secs.unwrap_or(15);
    let slots_per_loop = input.slots_per_loop.unwrap_or(1);
    let priority = input.priority.unwrap_or(0);

    let result = sqlx::query(
        "UPDATE bookings SET campaign_id = ?, booking_type = ?, target_type = ?, target_id = ?, \
         start_date = ?, end_date = ?, start_time = ?, end_time = ?, days_of_week = ?, \
         slot_duration_secs = ?, slots_per_loop = ?, priority = ?, notes = ?, \
         updated_at = datetime('now') WHERE id = ?"
    )
    .bind(&input.campaign_id)
    .bind(&input.booking_type)
    .bind(&input.target_type)
    .bind(&input.target_id)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&days)
    .bind(slot_duration)
    .bind(slots_per_loop)
    .bind(priority)
    .bind(&input.notes)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_booking(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM bookings WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
