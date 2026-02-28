use std::path::PathBuf;

use axum::{
    Json, Router,
    extract::{Multipart, Path, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use tower_http::services::ServeDir;
use uuid::Uuid;

use crate::{AppState, db, models::*, ws};

/// Build the full application router.
pub fn create_router(state: AppState) -> Router {
    Router::new()
        // Boards
        .route("/api/boards", get(list_boards).post(create_board))
        .route("/api/boards/{id}", get(get_board))
        .route("/api/boards/{id}/command", post(send_board_command))
        // Groups
        .route("/api/groups", get(list_groups).post(create_group))
        .route("/api/groups/{id}", delete(delete_group))
        .route("/api/groups/{id}/command", post(send_group_command))
        // Media
        .route("/api/media", get(list_media).post(upload_media))
        .route("/api/media/{id}/download", get(download_media))
        .route("/api/media/{id}", delete(delete_media))
        // Playlists
        .route("/api/playlists", get(list_playlists).post(create_playlist))
        .route(
            "/api/playlists/{id}",
            get(get_playlist).put(update_playlist).delete(delete_playlist),
        )
        // Schedules
        .route(
            "/api/schedules",
            get(list_schedules).post(create_schedule),
        )
        .route("/api/schedules/{id}", delete(delete_schedule))
        // WebSocket
        .route("/ws/agent", get(ws_agent_handler))
        .with_state(state)
        // Serve the web dashboard as static files (fallback for non-API routes)
        .fallback_service(ServeDir::new("static").append_index_html_on_directories(true))
}

// ── Boards ──────────────────────────────────────────────────────────────

async fn list_boards(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_boards(&state.db).await {
        Ok(boards) => Json(boards).into_response(),
        Err(e) => {
            tracing::error!("list_boards: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_board(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_board(&state.db, &id).await {
        Ok(Some(board)) => Json(board).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_board: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_board(
    State(state): State<AppState>,
    Json(input): Json<CreateBoard>,
) -> impl IntoResponse {
    match db::create_board(&state.db, &input).await {
        Ok(board) => (StatusCode::CREATED, Json(board)).into_response(),
        Err(e) => {
            tracing::error!("create_board: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn send_board_command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CommandRequest>,
) -> impl IntoResponse {
    let sent = ws::send_command_to_board(&state.agents, &id, &req.command).await;
    if sent {
        StatusCode::OK.into_response()
    } else {
        (StatusCode::NOT_FOUND, "Board not connected").into_response()
    }
}

// ── Groups ──────────────────────────────────────────────────────────────

async fn list_groups(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_groups(&state.db).await {
        Ok(groups) => Json(groups).into_response(),
        Err(e) => {
            tracing::error!("list_groups: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_group(
    State(state): State<AppState>,
    Json(input): Json<CreateGroup>,
) -> impl IntoResponse {
    match db::create_group(&state.db, &input).await {
        Ok(group) => (StatusCode::CREATED, Json(group)).into_response(),
        Err(e) => {
            tracing::error!("create_group: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_group(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_group: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn send_group_command(
    State(state): State<AppState>,
    Path(group_id): Path<String>,
    Json(req): Json<CommandRequest>,
) -> impl IntoResponse {
    // Find all boards in the group and send the command to each connected one.
    let boards = match db::get_boards_by_group(&state.db, &group_id).await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("send_group_command: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let mut sent_count = 0u32;
    for board in &boards {
        if ws::send_command_to_board(&state.agents, &board.id, &req.command).await {
            sent_count += 1;
        }
    }

    Json(serde_json::json!({
        "boards_total": boards.len(),
        "boards_sent": sent_count,
    }))
    .into_response()
}

// ── Media ───────────────────────────────────────────────────────────────

async fn list_media(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_media(&state.db).await {
        Ok(media) => Json(media).into_response(),
        Err(e) => {
            tracing::error!("list_media: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn upload_media(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let id = Uuid::new_v4().to_string();
    let mut original_name = String::new();
    let mut filename = String::new();
    let mut mime = String::from("application/octet-stream");
    let mut size: i64 = 0;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "file" {
            original_name = field
                .file_name()
                .unwrap_or("unknown")
                .to_string();

            if let Some(ct) = field.content_type() {
                mime = ct.to_string();
            }

            // Generate a unique filename to avoid collisions.
            let ext = original_name
                .rsplit('.')
                .next()
                .unwrap_or("bin");
            filename = format!("{}.{}", id, ext);

            let dest = PathBuf::from(&state.media_dir).join(&filename);
            let data = match field.bytes().await {
                Ok(d) => d,
                Err(e) => {
                    tracing::error!("upload read error: {}", e);
                    return StatusCode::BAD_REQUEST.into_response();
                }
            };
            size = data.len() as i64;
            if let Err(e) = tokio::fs::write(&dest, &data).await {
                tracing::error!("upload write error: {}", e);
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }

    if filename.is_empty() {
        return (StatusCode::BAD_REQUEST, "No file field found").into_response();
    }

    let media = Media {
        id: id.clone(),
        name: original_name,
        filename,
        mime_type: mime,
        size,
        uploaded_at: String::new(), // DB default
    };

    match db::insert_media(&state.db, &media).await {
        Ok(()) => {
            // Re-fetch to get the DB-generated uploaded_at
            match db::get_media(&state.db, &id).await {
                Ok(Some(m)) => (StatusCode::CREATED, Json(m)).into_response(),
                _ => StatusCode::CREATED.into_response(),
            }
        }
        Err(e) => {
            tracing::error!("insert_media: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn download_media(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let media = match db::get_media(&state.db, &id).await {
        Ok(Some(m)) => m,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("download_media: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let path = PathBuf::from(&state.media_dir).join(&media.filename);
    match tokio::fs::read(&path).await {
        Ok(data) => {
            let headers = [
                (
                    axum::http::header::CONTENT_TYPE,
                    media.mime_type.clone(),
                ),
                (
                    axum::http::header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", media.name),
                ),
            ];
            (headers, data).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn delete_media(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Get media info first so we can delete the file.
    let media = match db::get_media(&state.db, &id).await {
        Ok(Some(m)) => m,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_media: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    // Delete file from disk.
    let path = PathBuf::from(&state.media_dir).join(&media.filename);
    let _ = tokio::fs::remove_file(&path).await;

    match db::delete_media(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_media: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Playlists ───────────────────────────────────────────────────────────

async fn list_playlists(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_playlists(&state.db).await {
        Ok(rows) => {
            let responses: Vec<PlaylistResponse> = rows
                .into_iter()
                .map(playlist_row_to_response)
                .collect();
            Json(responses).into_response()
        }
        Err(e) => {
            tracing::error!("list_playlists: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_playlist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_playlist(&state.db, &id).await {
        Ok(Some(row)) => Json(playlist_row_to_response(row)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_playlist: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_playlist(
    State(state): State<AppState>,
    Json(input): Json<CreatePlaylist>,
) -> impl IntoResponse {
    let id = Uuid::new_v4().to_string();
    let items_json = serde_json::to_string(&input.items).unwrap_or_else(|_| "[]".to_string());

    match db::create_playlist(&state.db, &id, &input.name, &items_json, input.loop_playlist).await {
        Ok(row) => (StatusCode::CREATED, Json(playlist_row_to_response(row))).into_response(),
        Err(e) => {
            tracing::error!("create_playlist: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn update_playlist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreatePlaylist>,
) -> impl IntoResponse {
    let items_json = serde_json::to_string(&input.items).unwrap_or_else(|_| "[]".to_string());

    match db::update_playlist(&state.db, &id, &input.name, &items_json, input.loop_playlist).await {
        Ok(true) => {
            match db::get_playlist(&state.db, &id).await {
                Ok(Some(row)) => Json(playlist_row_to_response(row)).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_playlist: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_playlist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_playlist(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_playlist: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn playlist_row_to_response(row: PlaylistRow) -> PlaylistResponse {
    let items: Vec<mepl_core::MediaItem> =
        serde_json::from_str(&row.items).unwrap_or_default();
    PlaylistResponse {
        id: row.id,
        name: row.name,
        items,
        loop_playlist: row.loop_playlist,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

// ── Schedules ───────────────────────────────────────────────────────────

async fn list_schedules(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_schedules(&state.db).await {
        Ok(schedules) => Json(schedules).into_response(),
        Err(e) => {
            tracing::error!("list_schedules: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_schedule(
    State(state): State<AppState>,
    Json(input): Json<CreateSchedule>,
) -> impl IntoResponse {
    match db::create_schedule(&state.db, &input).await {
        Ok(schedule) => (StatusCode::CREATED, Json(schedule)).into_response(),
        Err(e) => {
            tracing::error!("create_schedule: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_schedule(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_schedule: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── WebSocket ───────────────────────────────────────────────────────────

async fn ws_agent_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws::handle_agent_socket(socket, state.agents, state.db))
}
