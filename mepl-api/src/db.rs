use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use uuid::Uuid;

use crate::models::*;

const MIGRATION_SQL: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002_SQL: &str = include_str!("../migrations/002_indexes.sql");

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

    tracing::info!("Database initialized at {}", path);
    Ok(pool)
}

// ── Boards ──────────────────────────────────────────────────────────────

pub async fn list_boards(pool: &SqlitePool) -> Result<Vec<Board>, sqlx::Error> {
    sqlx::query_as::<_, Board>("SELECT id, name, group_id, status, last_seen, config, created_at FROM boards ORDER BY created_at DESC")
        .fetch_all(pool)
        .await
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

pub async fn list_groups(pool: &SqlitePool) -> Result<Vec<Group>, sqlx::Error> {
    sqlx::query_as::<_, Group>("SELECT id, name, created_at FROM groups ORDER BY created_at DESC")
        .fetch_all(pool)
        .await
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

pub async fn list_media(pool: &SqlitePool) -> Result<Vec<Media>, sqlx::Error> {
    sqlx::query_as::<_, Media>(
        "SELECT id, name, filename, mime_type, size, uploaded_at FROM media ORDER BY uploaded_at DESC",
    )
    .fetch_all(pool)
    .await
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

pub async fn list_playlists(pool: &SqlitePool) -> Result<Vec<PlaylistRow>, sqlx::Error> {
    sqlx::query_as::<_, PlaylistRow>(
        "SELECT id, name, items, loop_playlist, created_at, updated_at FROM playlists ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
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

pub async fn list_schedules(pool: &SqlitePool) -> Result<Vec<Schedule>, sqlx::Error> {
    sqlx::query_as::<_, Schedule>(
        "SELECT id, board_id, group_id, playlist_id, start_time, end_time, days_of_week, priority, created_at FROM schedules ORDER BY priority DESC",
    )
    .fetch_all(pool)
    .await
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
