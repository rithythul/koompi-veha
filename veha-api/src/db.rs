use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use uuid::Uuid;

use crate::models::*;

const MIGRATION_SQL: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002_SQL: &str = include_str!("../migrations/002_indexes.sql");
const MIGRATION_003_SQL: &str = include_str!("../migrations/003_veha.sql");
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

    // Run veha migration (003) — check if zones table already exists
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
        tracing::info!("veha migration (003) applied");
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

const BOARD_COLUMNS: &str = "id, name, group_id, status, last_seen, config, created_at, \
    zone_id, latitude, longitude, address, board_type, screen_width, screen_height, \
    orientation, sell_mode, operating_hours_start, operating_hours_end";

pub async fn list_boards(pool: &SqlitePool, filter: &BoardFilter) -> Result<(Vec<Board>, i64), sqlx::Error> {
    let offset = ((filter.page.max(1) - 1) * filter.per_page) as i64;
    let limit = filter.per_page.min(200) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM boards WHERE \
         (? IS NULL OR zone_id = ?) AND \
         (? IS NULL OR sell_mode = ?) AND \
         (? IS NULL OR status = ?)"
    )
    .bind(&filter.zone_id).bind(&filter.zone_id)
    .bind(&filter.sell_mode).bind(&filter.sell_mode)
    .bind(&filter.status).bind(&filter.status)
    .fetch_one(pool)
    .await?;

    let sql = format!(
        "SELECT {} FROM boards WHERE \
         (? IS NULL OR zone_id = ?) AND \
         (? IS NULL OR sell_mode = ?) AND \
         (? IS NULL OR status = ?) \
         ORDER BY created_at DESC LIMIT ? OFFSET ?",
        BOARD_COLUMNS
    );

    let boards = sqlx::query_as::<_, Board>(&sql)
        .bind(&filter.zone_id).bind(&filter.zone_id)
        .bind(&filter.sell_mode).bind(&filter.sell_mode)
        .bind(&filter.status).bind(&filter.status)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    Ok((boards, total.0))
}

pub async fn get_board(pool: &SqlitePool, id: &str) -> Result<Option<Board>, sqlx::Error> {
    let sql = format!("SELECT {} FROM boards WHERE id = ?", BOARD_COLUMNS);
    sqlx::query_as::<_, Board>(&sql)
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

pub async fn update_board(pool: &SqlitePool, id: &str, input: &UpdateBoard) -> Result<bool, sqlx::Error> {
    // Build SET clauses with positional bind parameters to prevent SQL injection.
    let mut set_clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Option<String>> = Vec::new();

    macro_rules! set_field {
        // Required string field: Some(value) => SET col = ?
        (required $col:literal, $field:expr) => {
            if let Some(ref v) = $field {
                set_clauses.push(format!("{} = ?", $col));
                binds.push(Some(v.clone()));
            }
        };
        // Nullable string field: Some(Some(v)) => SET col = ?, Some(None) => SET col = NULL
        (nullable $col:literal, $field:expr) => {
            if let Some(ref opt) = $field {
                set_clauses.push(format!("{} = ?", $col));
                binds.push(opt.clone());
            }
        };
        // Nullable numeric field (f64): convert to string for binding
        (nullable_f64 $col:literal, $field:expr) => {
            if let Some(ref opt) = $field {
                set_clauses.push(format!("{} = ?", $col));
                binds.push(opt.map(|v| v.to_string()));
            }
        };
        // Nullable integer field: convert to string for binding
        (nullable_i32 $col:literal, $field:expr) => {
            if let Some(ref opt) = $field {
                set_clauses.push(format!("{} = ?", $col));
                binds.push(opt.map(|v: i32| v.to_string()));
            }
        };
    }

    set_field!(required "name", input.name);
    set_field!(nullable "group_id", input.group_id);
    set_field!(nullable "zone_id", input.zone_id);
    set_field!(nullable_f64 "latitude", input.latitude);
    set_field!(nullable_f64 "longitude", input.longitude);
    set_field!(nullable "address", input.address);
    set_field!(required "board_type", input.board_type);
    set_field!(nullable_i32 "screen_width", input.screen_width);
    set_field!(nullable_i32 "screen_height", input.screen_height);
    set_field!(required "orientation", input.orientation);
    set_field!(required "sell_mode", input.sell_mode);
    set_field!(nullable "operating_hours_start", input.operating_hours_start);
    set_field!(nullable "operating_hours_end", input.operating_hours_end);

    if set_clauses.is_empty() {
        return Ok(false);
    }

    let sql = format!("UPDATE boards SET {} WHERE id = ?", set_clauses.join(", "));
    let mut query = sqlx::query(&sql);
    for bind in &binds {
        query = match bind {
            Some(v) => query.bind(v),
            None => query.bind(None::<String>),
        };
    }
    query = query.bind(id);
    let result = query.execute(pool).await?;
    Ok(result.rows_affected() > 0)
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
    let sql = format!("SELECT {} FROM boards WHERE group_id = ?", BOARD_COLUMNS);
    sqlx::query_as::<_, Board>(&sql)
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

pub async fn update_group(pool: &SqlitePool, id: &str, input: &CreateGroup) -> Result<Option<Group>, sqlx::Error> {
    let result = sqlx::query("UPDATE groups SET name = ? WHERE id = ?")
        .bind(&input.name)
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Ok(None);
    }
    get_group(pool, id).await
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

pub async fn rename_media(pool: &SqlitePool, id: &str, name: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE media SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
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

pub async fn get_schedule(pool: &SqlitePool, id: &str) -> Result<Option<Schedule>, sqlx::Error> {
    sqlx::query_as::<_, Schedule>(
        "SELECT id, board_id, group_id, playlist_id, start_time, end_time, days_of_week, priority, created_at FROM schedules WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_schedule(pool: &SqlitePool, id: &str, input: &CreateSchedule) -> Result<bool, sqlx::Error> {
    let days = input.days_of_week.clone().unwrap_or_else(|| "0,1,2,3,4,5,6".to_string());
    let priority = input.priority.unwrap_or(0);

    let result = sqlx::query(
        "UPDATE schedules SET board_id = ?, group_id = ?, playlist_id = ?, start_time = ?, end_time = ?, days_of_week = ?, priority = ? WHERE id = ?",
    )
    .bind(&input.board_id)
    .bind(&input.group_id)
    .bind(&input.playlist_id)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&days)
    .bind(priority)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
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

pub async fn list_users(
    pool: &SqlitePool,
    page: u32,
    per_page: u32,
) -> Result<(Vec<User>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let users = sqlx::query_as::<_, User>(
        "SELECT id, username, password_hash, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((users, total.0))
}

pub async fn get_user(pool: &SqlitePool, id: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_user(
    pool: &SqlitePool,
    id: &str,
    username: Option<&str>,
    role: Option<&str>,
) -> Result<bool, sqlx::Error> {
    // Build dynamic SET clauses
    let mut sets = Vec::new();
    if username.is_some() {
        sets.push("username = ?");
    }
    if role.is_some() {
        sets.push("role = ?");
    }
    if sets.is_empty() {
        return Ok(false);
    }

    let sql = format!("UPDATE users SET {} WHERE id = ?", sets.join(", "));
    let mut query = sqlx::query(&sql);

    if let Some(u) = username {
        query = query.bind(u);
    }
    if let Some(r) = role {
        query = query.bind(r);
    }
    query = query.bind(id);

    let result = query.execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn update_user_password(
    pool: &SqlitePool,
    id: &str,
    password_hash: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(password_hash)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_user(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    // Also delete user's sessions
    sqlx::query("DELETE FROM sessions WHERE user_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    let result = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
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

pub async fn get_creative(pool: &SqlitePool, id: &str) -> Result<Option<Creative>, sqlx::Error> {
    sqlx::query_as::<_, Creative>(
        "SELECT id, campaign_id, media_id, name, duration_secs, status, created_at \
         FROM creatives WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_creative(pool: &SqlitePool, id: &str, input: &CreateCreative, status: Option<&str>) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE creatives SET media_id = ?, name = ?, duration_secs = ?, status = COALESCE(?, status) WHERE id = ?"
    )
    .bind(&input.media_id)
    .bind(&input.name)
    .bind(input.duration_secs)
    .bind(status)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
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

/// Check for overlapping exclusive bookings on same target + time range.
pub async fn check_booking_conflict(
    pool: &SqlitePool,
    target_type: &str,
    target_id: &str,
    start_date: &str,
    end_date: &str,
    exclude_id: Option<&str>,
) -> Result<Option<Booking>, sqlx::Error> {
    let exclude_clause = if exclude_id.is_some() { "AND id != ?" } else { "" };
    let sql = format!(
        "SELECT id, campaign_id, booking_type, target_type, target_id, start_date, end_date, \
         start_time, end_time, days_of_week, slot_duration_secs, slots_per_loop, priority, \
         status, notes, created_at, updated_at \
         FROM bookings WHERE \
         booking_type = 'exclusive' AND \
         target_type = ? AND target_id = ? AND \
         status IN ('confirmed', 'active') AND \
         start_date <= ? AND end_date >= ? \
         {exclude_clause} \
         LIMIT 1"
    );
    let mut query = sqlx::query_as::<_, Booking>(&sql)
        .bind(target_type)
        .bind(target_id)
        .bind(end_date) // their start <= our end
        .bind(start_date); // their end >= our start
    if let Some(eid) = exclude_id {
        query = query.bind(eid);
    }
    query.fetch_optional(pool).await
}

// ── Resolution helpers ─────────────────────────────────────────────────

/// Get zone ancestry (zone_id + all parent IDs up the tree).
pub async fn get_zone_ancestry(pool: &SqlitePool, zone_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let mut ids = vec![zone_id.to_string()];
    let mut current = zone_id.to_string();
    loop {
        let zone: Option<Zone> = get_zone(pool, &current).await?;
        match zone.and_then(|z| z.parent_id) {
            Some(parent) => {
                ids.push(parent.clone());
                current = parent;
            }
            None => break,
        }
    }
    Ok(ids)
}

/// Get all descendant zone IDs (children, grandchildren, etc.) for a zone.
pub async fn get_zone_descendant_ids(pool: &SqlitePool, zone_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let mut result = Vec::new();
    let mut queue = vec![zone_id.to_string()];
    while let Some(current) = queue.pop() {
        let children: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM zones WHERE parent_id = ?",
        )
        .bind(&current)
        .fetch_all(pool)
        .await?;
        for (child_id,) in children {
            result.push(child_id.clone());
            queue.push(child_id);
        }
    }
    Ok(result)
}

/// Given a booking, resolve all board IDs that are affected by it.
pub async fn resolve_booking_board_ids(pool: &SqlitePool, booking: &Booking) -> Result<Vec<String>, sqlx::Error> {
    match booking.target_type.as_str() {
        "board" => Ok(vec![booking.target_id.clone()]),
        "zone" => {
            // Get all boards in this zone and all descendant zones
            let mut zone_ids = vec![booking.target_id.clone()];
            zone_ids.extend(get_zone_descendant_ids(pool, &booking.target_id).await?);
            if zone_ids.is_empty() {
                return Ok(vec![]);
            }
            let placeholders = zone_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("SELECT id FROM boards WHERE zone_id IN ({placeholders})");
            let mut query = sqlx::query_as::<_, (String,)>(&sql);
            for zid in &zone_ids {
                query = query.bind(zid);
            }
            let rows = query.fetch_all(pool).await?;
            Ok(rows.into_iter().map(|(id,)| id).collect())
        }
        "group" => {
            let rows: Vec<(String,)> = sqlx::query_as(
                "SELECT id FROM boards WHERE group_id = ?",
            )
            .bind(&booking.target_id)
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(|(id,)| id).collect())
        }
        _ => Ok(vec![]),
    }
}

/// Get approved creatives for a campaign.
pub async fn get_approved_creatives(pool: &SqlitePool, campaign_id: &str) -> Result<Vec<Creative>, sqlx::Error> {
    sqlx::query_as::<_, Creative>(
        "SELECT id, campaign_id, media_id, name, duration_secs, status, created_at \
         FROM creatives WHERE campaign_id = ? AND status = 'approved' ORDER BY created_at"
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await
}

/// Get active bookings for a board (direct + zone ancestry + group).
/// Filters by date, time, and day_of_week. Sorted by priority DESC, created_at ASC.
pub async fn get_active_bookings_for_board(
    pool: &SqlitePool,
    board_id: &str,
    zone_ids: &[String],
    group_id: Option<&str>,
    today: &str,
    current_time: &str,
) -> Result<Vec<Booking>, sqlx::Error> {
    // Build zone IN clause
    let zone_placeholders = if zone_ids.is_empty() {
        "''".to_string() // won't match anything
    } else {
        zone_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",")
    };

    let group_clause = if group_id.is_some() {
        "OR (target_type = 'group' AND target_id = ?)"
    } else {
        ""
    };

    let sql = format!(
        "SELECT id, campaign_id, booking_type, target_type, target_id, start_date, end_date, \
         start_time, end_time, days_of_week, slot_duration_secs, slots_per_loop, priority, \
         status, notes, created_at, updated_at \
         FROM bookings WHERE \
         status IN ('confirmed', 'active') \
         AND start_date <= ? AND end_date >= ? \
         AND (start_time IS NULL OR start_time <= ?) \
         AND (end_time IS NULL OR end_time >= ?) \
         AND ( \
           (target_type = 'board' AND target_id = ?) \
           OR (target_type = 'zone' AND target_id IN ({zone_placeholders})) \
           {group_clause} \
         ) \
         ORDER BY priority DESC, created_at ASC"
    );

    let mut query = sqlx::query_as::<_, Booking>(&sql);
    // Bind date/time params
    query = query.bind(today).bind(today).bind(current_time).bind(current_time);
    // Bind board_id
    query = query.bind(board_id);
    // Bind zone_ids
    for zid in zone_ids {
        query = query.bind(zid);
    }
    // Bind group_id if present
    if let Some(gid) = group_id {
        query = query.bind(gid);
    }

    let mut bookings = query.fetch_all(pool).await?;

    // Filter by day_of_week in Rust (SQLite doesn't have good array support)
    let now = chrono::Utc::now();
    let day_of_week = now.format("%w").to_string(); // 0=Sun, 6=Sat
    bookings.retain(|b| {
        b.days_of_week.split(',').any(|d| d.trim() == day_of_week)
    });

    Ok(bookings)
}

// ── Play Logs ──────────────────────────────────────────────────────────

pub async fn insert_play_log(
    pool: &SqlitePool,
    board_id: &str,
    booking_id: Option<&str>,
    creative_id: Option<&str>,
    media_id: Option<&str>,
    started_at: &str,
    ended_at: Option<&str>,
    duration_secs: Option<i32>,
    status: &str,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO play_logs (id, board_id, booking_id, creative_id, media_id, started_at, ended_at, duration_secs, status) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id).bind(board_id).bind(booking_id).bind(creative_id).bind(media_id)
    .bind(started_at).bind(ended_at).bind(duration_secs).bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_play_logs(pool: &SqlitePool, filter: &PlayLogFilter) -> Result<(Vec<PlayLog>, i64), sqlx::Error> {
    let offset = ((filter.page.max(1) - 1) * filter.per_page) as i64;
    let limit = filter.per_page.min(200) as i64;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM play_logs WHERE \
         (? IS NULL OR board_id = ?) AND \
         (? IS NULL OR booking_id = ?) AND \
         (? IS NULL OR date(started_at) >= ?) AND \
         (? IS NULL OR date(started_at) <= ?)"
    )
    .bind(&filter.board_id).bind(&filter.board_id)
    .bind(&filter.booking_id).bind(&filter.booking_id)
    .bind(&filter.start_date).bind(&filter.start_date)
    .bind(&filter.end_date).bind(&filter.end_date)
    .fetch_one(pool)
    .await?;

    let items = sqlx::query_as::<_, PlayLog>(
        "SELECT id, board_id, booking_id, creative_id, media_id, started_at, ended_at, \
         duration_secs, status, created_at FROM play_logs WHERE \
         (? IS NULL OR board_id = ?) AND \
         (? IS NULL OR booking_id = ?) AND \
         (? IS NULL OR date(started_at) >= ?) AND \
         (? IS NULL OR date(started_at) <= ?) \
         ORDER BY started_at DESC LIMIT ? OFFSET ?"
    )
    .bind(&filter.board_id).bind(&filter.board_id)
    .bind(&filter.booking_id).bind(&filter.booking_id)
    .bind(&filter.start_date).bind(&filter.start_date)
    .bind(&filter.end_date).bind(&filter.end_date)
    .bind(limit).bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((items, total.0))
}

pub async fn play_log_summary(
    pool: &SqlitePool,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<PlayLogSummary>, sqlx::Error> {
    sqlx::query_as::<_, PlayLogSummary>(
        "SELECT date(started_at) as date, board_id, booking_id, \
         COUNT(*) as play_count, COALESCE(SUM(duration_secs), 0) as total_duration_secs \
         FROM play_logs WHERE date(started_at) BETWEEN ? AND ? \
         GROUP BY date(started_at), board_id, booking_id \
         ORDER BY date DESC, play_count DESC"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
}

pub async fn list_play_logs_by_booking(
    pool: &SqlitePool,
    booking_id: &str,
    page: u32,
    per_page: u32,
) -> Result<(Vec<PlayLog>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM play_logs WHERE booking_id = ?"
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;

    let items = sqlx::query_as::<_, PlayLog>(
        "SELECT id, board_id, booking_id, creative_id, media_id, started_at, ended_at, \
         duration_secs, status, created_at FROM play_logs WHERE booking_id = ? \
         ORDER BY started_at DESC LIMIT ? OFFSET ?"
    )
    .bind(booking_id)
    .bind(limit).bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((items, total.0))
}
