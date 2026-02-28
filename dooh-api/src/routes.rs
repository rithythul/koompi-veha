use std::path::PathBuf;

use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
};
use tokio::io::AsyncWriteExt;
use tower_http::services::ServeDir;
use uuid::Uuid;

use crate::{AppState, auth, db, models::*, ws};

/// Build the full application router.
pub fn create_router(state: AppState) -> Router {
    Router::new()
        // Health
        .route("/health", get(health_check))
        // Auth
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(auth_me))
        // Boards
        .route("/api/boards", get(list_boards).post(create_board))
        .route("/api/boards/{id}", get(get_board).put(update_board_handler))
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
        // Zones
        .route("/api/zones", get(list_zones_handler).post(create_zone_handler))
        .route(
            "/api/zones/{id}",
            get(get_zone_detail_handler).put(update_zone_handler).delete(delete_zone_handler),
        )
        // Advertisers
        .route("/api/advertisers", get(list_advertisers_handler).post(create_advertiser_handler))
        .route(
            "/api/advertisers/{id}",
            get(get_advertiser_handler).put(update_advertiser_handler).delete(delete_advertiser_handler),
        )
        // Campaigns
        .route("/api/campaigns", get(list_campaigns_handler).post(create_campaign_handler))
        .route(
            "/api/campaigns/{id}",
            get(get_campaign_handler).put(update_campaign_handler).delete(delete_campaign_handler),
        )
        .route("/api/campaigns/{id}/activate", post(activate_campaign_handler))
        .route("/api/campaigns/{id}/pause", post(pause_campaign_handler))
        .route(
            "/api/campaigns/{id}/creatives",
            get(list_creatives_handler).post(create_creative_handler),
        )
        // Creatives
        .route("/api/creatives/{id}", delete(delete_creative_handler))
        // Bookings
        .route("/api/bookings", get(list_bookings_handler).post(create_booking_handler))
        .route(
            "/api/bookings/{id}",
            get(get_booking_handler).put(update_booking_handler).delete(delete_booking_handler),
        )
        // Play Logs
        .route("/api/play-logs", get(list_play_logs_handler))
        .route("/api/play-logs/summary", get(play_log_summary_handler))
        .route("/api/bookings/{id}/play-logs", get(booking_play_logs_handler))
        // Schedule Resolution
        .route("/api/boards/{id}/resolved-schedule", get(get_resolved_schedule_handler))
        // WebSocket
        .route("/ws/agent", get(ws_agent_handler))
        // Auth middleware — applied to all routes above
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ))
        .with_state(state)
        // Serve the web dashboard as static files (fallback for non-API routes)
        .fallback_service(ServeDir::new("static").append_index_html_on_directories(true))
}

// ── Health ──────────────────────────────────────────────────────────────

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => Json(serde_json::json!({
            "status": "ok",
            "agents_connected": state.agents.read().await.len(),
        })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "status": "unhealthy",
            "error": "database unreachable"
        }))).into_response(),
    }
}

// ── Auth ────────────────────────────────────────────────────────────────

async fn login(
    State(state): State<AppState>,
    Json(input): Json<LoginRequest>,
) -> impl IntoResponse {
    let user = match db::get_user_by_username(&state.db, &input.username).await {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response(),
        Err(e) => {
            tracing::error!("login: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    if !auth::verify_password(&input.password, &user.password_hash) {
        return (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response();
    }

    let session_id = Uuid::new_v4().to_string();
    let expires = chrono::Utc::now() + chrono::Duration::hours(24);
    let expires_str = expires.format("%Y-%m-%d %H:%M:%S").to_string();

    if let Err(e) = db::create_session(&state.db, &session_id, &user.id, &expires_str).await {
        tracing::error!("create_session: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let cookie = format!(
        "dooh_session={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
        session_id
    );

    let mut response = Json(UserResponse::from(user)).into_response();
    response.headers_mut().insert(
        axum::http::header::SET_COOKIE,
        cookie.parse().unwrap(),
    );
    response
}

async fn logout(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if let Some(token) = auth::extract_session_token(&headers) {
        let _ = db::delete_session(&state.db, token).await;
    }
    let cookie = "dooh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        axum::http::header::SET_COOKIE,
        cookie.parse().unwrap(),
    );
    response
}

async fn auth_me(headers: HeaderMap, State(state): State<AppState>) -> impl IntoResponse {
    if let Some(token) = auth::extract_session_token(&headers) {
        if let Ok(Some(user)) = db::get_valid_session(&state.db, token).await {
            return Json(UserResponse::from(user)).into_response();
        }
    }
    StatusCode::UNAUTHORIZED.into_response()
}

// ── Boards ──────────────────────────────────────────────────────────────

async fn list_boards(
    State(state): State<AppState>,
    Query(filter): Query<BoardFilter>,
) -> impl IntoResponse {
    let page = filter.page;
    let per_page = filter.per_page;
    match db::list_boards(&state.db, &filter).await {
        Ok((boards, total)) => Json(PaginatedResponse {
            data: boards,
            total,
            page,
            per_page,
        }).into_response(),
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

async fn update_board_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateBoard>,
) -> impl IntoResponse {
    match db::update_board(&state.db, &id, &input).await {
        Ok(true) => {
            match db::get_board(&state.db, &id).await {
                Ok(Some(board)) => Json(board).into_response(),
                _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_board: {}", e);
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

async fn list_groups(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_groups(&state.db, params.page, params.per_page).await {
        Ok((groups, total)) => Json(PaginatedResponse {
            data: groups,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
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

async fn list_media(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_media(&state.db, params.page, params.per_page).await {
        Ok((media, total)) => Json(PaginatedResponse {
            data: media,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_media: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// Maximum upload size: 2GB
const MAX_UPLOAD_SIZE: u64 = 2 * 1024 * 1024 * 1024;

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

            let ext = original_name
                .rsplit('.')
                .next()
                .unwrap_or("bin");
            filename = format!("{}.{}", id, ext);

            let dest = PathBuf::from(&state.media_dir).join(&filename);

            // Stream directly to file instead of loading into memory
            let mut file = match tokio::fs::File::create(&dest).await {
                Ok(f) => f,
                Err(e) => {
                    tracing::error!("upload create file error: {}", e);
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };

            let mut total_bytes: u64 = 0;
            let mut stream = field;

            loop {
                match stream.chunk().await {
                    Ok(Some(chunk)) => {
                        total_bytes += chunk.len() as u64;
                        if total_bytes > MAX_UPLOAD_SIZE {
                            // Clean up partial file
                            drop(file);
                            let _ = tokio::fs::remove_file(&dest).await;
                            return (StatusCode::PAYLOAD_TOO_LARGE, "File exceeds 2GB limit").into_response();
                        }
                        if let Err(e) = file.write_all(&chunk).await {
                            tracing::error!("upload write error: {}", e);
                            drop(file);
                            let _ = tokio::fs::remove_file(&dest).await;
                            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                        }
                    }
                    Ok(None) => break,  // End of field
                    Err(e) => {
                        tracing::error!("upload read error: {}", e);
                        drop(file);
                        let _ = tokio::fs::remove_file(&dest).await;
                        return StatusCode::BAD_REQUEST.into_response();
                    }
                }
            }

            size = total_bytes as i64;
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
        uploaded_at: String::new(),
    };

    match db::insert_media(&state.db, &media).await {
        Ok(()) => {
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

    // Validate path stays within media_dir
    match path.canonicalize() {
        Ok(canonical) => {
            let media_dir = match PathBuf::from(&state.media_dir).canonicalize() {
                Ok(d) => d,
                Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
            if !canonical.starts_with(&media_dir) {
                tracing::error!("Path traversal attempt: {:?}", path);
                return StatusCode::FORBIDDEN.into_response();
            }
        }
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    }

    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };

    let stream = tokio_util::io::ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

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

    (headers, body).into_response()
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

async fn list_playlists(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_playlists(&state.db, params.page, params.per_page).await {
        Ok((rows, total)) => {
            let responses: Vec<PlaylistResponse> = rows
                .into_iter()
                .map(playlist_row_to_response)
                .collect();
            Json(PaginatedResponse {
                data: responses,
                total,
                page: params.page,
                per_page: params.per_page,
            }).into_response()
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
    let items: Vec<dooh_core::MediaItem> =
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

async fn list_schedules(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_schedules(&state.db, params.page, params.per_page).await {
        Ok((schedules, total)) => Json(PaginatedResponse {
            data: schedules,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
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
    ws.on_upgrade(move |socket| ws::handle_agent_socket(socket, state.agents, state.db, state.api_key))
}

// ── Zones ───────────────────────────────────────────────────────────────

async fn list_zones_handler(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_zones(&state.db).await {
        Ok(zones) => Json(zones).into_response(),
        Err(e) => {
            tracing::error!("list_zones: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_zone_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateZone>,
) -> impl IntoResponse {
    match db::create_zone(&state.db, &input).await {
        Ok(zone) => (StatusCode::CREATED, Json(zone)).into_response(),
        Err(e) => {
            tracing::error!("create_zone: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_zone_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let zone = match db::get_zone(&state.db, &id).await {
        Ok(Some(z)) => z,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_zone: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let children = match db::get_zone_children(&state.db, &id).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("get_zone_children: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let board_count = match db::get_zone_board_count(&state.db, &id).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("get_zone_board_count: {}", e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    Json(ZoneDetail { zone, children, board_count }).into_response()
}

async fn update_zone_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateZone>,
) -> impl IntoResponse {
    match db::update_zone(&state.db, &id, &input).await {
        Ok(true) => {
            match db::get_zone(&state.db, &id).await {
                Ok(Some(zone)) => Json(zone).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_zone: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_zone_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_zone(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_zone: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Advertisers ─────────────────────────────────────────────────────────

async fn list_advertisers_handler(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_advertisers(&state.db, params.page, params.per_page).await {
        Ok((advertisers, total)) => Json(PaginatedResponse {
            data: advertisers,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_advertisers: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_advertiser_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateAdvertiser>,
) -> impl IntoResponse {
    match db::create_advertiser(&state.db, &input).await {
        Ok(advertiser) => (StatusCode::CREATED, Json(advertiser)).into_response(),
        Err(e) => {
            tracing::error!("create_advertiser: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_advertiser_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_advertiser(&state.db, &id).await {
        Ok(Some(advertiser)) => Json(advertiser).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_advertiser: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn update_advertiser_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateAdvertiser>,
) -> impl IntoResponse {
    match db::update_advertiser(&state.db, &id, &input).await {
        Ok(true) => {
            match db::get_advertiser(&state.db, &id).await {
                Ok(Some(advertiser)) => Json(advertiser).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_advertiser: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_advertiser_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_advertiser(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_advertiser: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Campaigns ───────────────────────────────────────────────────────────

async fn list_campaigns_handler(
    State(state): State<AppState>,
    Query(filter): Query<CampaignFilter>,
) -> impl IntoResponse {
    match db::list_campaigns(&state.db, &filter).await {
        Ok((campaigns, total)) => Json(PaginatedResponse {
            data: campaigns,
            total,
            page: filter.page,
            per_page: filter.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_campaigns: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_campaign_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateCampaign>,
) -> impl IntoResponse {
    match db::create_campaign(&state.db, &input).await {
        Ok(campaign) => (StatusCode::CREATED, Json(campaign)).into_response(),
        Err(e) => {
            tracing::error!("create_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_campaign_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_campaign(&state.db, &id).await {
        Ok(Some(campaign)) => Json(campaign).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn update_campaign_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateCampaign>,
) -> impl IntoResponse {
    match db::update_campaign(&state.db, &id, &input).await {
        Ok(true) => {
            match db::get_campaign(&state.db, &id).await {
                Ok(Some(campaign)) => Json(campaign).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_campaign_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_campaign(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn activate_campaign_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::activate_campaign(&state.db, &id).await {
        Ok(true) => {
            match db::get_campaign(&state.db, &id).await {
                Ok(Some(campaign)) => Json(campaign).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("activate_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn pause_campaign_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::pause_campaign(&state.db, &id).await {
        Ok(true) => {
            match db::get_campaign(&state.db, &id).await {
                Ok(Some(campaign)) => Json(campaign).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("pause_campaign: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Creatives ───────────────────────────────────────────────────────────

async fn list_creatives_handler(
    State(state): State<AppState>,
    Path(campaign_id): Path<String>,
) -> impl IntoResponse {
    match db::list_creatives_by_campaign(&state.db, &campaign_id).await {
        Ok(creatives) => Json(creatives).into_response(),
        Err(e) => {
            tracing::error!("list_creatives: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_creative_handler(
    State(state): State<AppState>,
    Path(campaign_id): Path<String>,
    Json(input): Json<CreateCreative>,
) -> impl IntoResponse {
    match db::create_creative(&state.db, &campaign_id, &input).await {
        Ok(creative) => (StatusCode::CREATED, Json(creative)).into_response(),
        Err(e) => {
            tracing::error!("create_creative: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_creative_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_creative(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_creative: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Bookings ────────────────────────────────────────────────────────────

async fn list_bookings_handler(
    State(state): State<AppState>,
    Query(filter): Query<BookingFilter>,
) -> impl IntoResponse {
    match db::list_bookings(&state.db, &filter).await {
        Ok((bookings, total)) => Json(PaginatedResponse {
            data: bookings,
            total,
            page: filter.page,
            per_page: filter.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_bookings: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn create_booking_handler(
    State(state): State<AppState>,
    Json(input): Json<CreateBooking>,
) -> impl IntoResponse {
    match db::create_booking(&state.db, &input).await {
        Ok(booking) => (StatusCode::CREATED, Json(booking)).into_response(),
        Err(e) => {
            tracing::error!("create_booking: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn get_booking_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::get_booking(&state.db, &id).await {
        Ok(Some(booking)) => Json(booking).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("get_booking: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn update_booking_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateBooking>,
) -> impl IntoResponse {
    match db::update_booking(&state.db, &id, &input).await {
        Ok(true) => {
            match db::get_booking(&state.db, &id).await {
                Ok(Some(booking)) => Json(booking).into_response(),
                _ => StatusCode::OK.into_response(),
            }
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("update_booking: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn delete_booking_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db::delete_booking(&state.db, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("delete_booking: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Play Logs ──────────────────────────────────────────────────────────

async fn list_play_logs_handler(
    State(state): State<AppState>,
    Query(filter): Query<PlayLogFilter>,
) -> impl IntoResponse {
    match db::list_play_logs(&state.db, &filter).await {
        Ok((logs, total)) => Json(PaginatedResponse {
            data: logs,
            total,
            page: filter.page,
            per_page: filter.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_play_logs: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn play_log_summary_handler(
    State(state): State<AppState>,
    Query(filter): Query<PlayLogSummaryFilter>,
) -> impl IntoResponse {
    match db::play_log_summary(&state.db, &filter.start_date, &filter.end_date).await {
        Ok(summary) => Json(summary).into_response(),
        Err(e) => {
            tracing::error!("play_log_summary: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn booking_play_logs_handler(
    State(state): State<AppState>,
    Path(booking_id): Path<String>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_play_logs_by_booking(&state.db, &booking_id, params.page, params.per_page).await {
        Ok((logs, total)) => Json(PaginatedResponse {
            data: logs,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("booking_play_logs: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ── Schedule Resolution ────────────────────────────────────────────────

async fn get_resolved_schedule_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match crate::resolver::resolve_for_board(&state.db, &id).await {
        Ok(resolved) => Json(resolved).into_response(),
        Err(e) => {
            tracing::error!("resolve_schedule: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
