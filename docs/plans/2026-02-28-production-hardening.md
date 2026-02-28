# Production Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform koompi-veha from a functional prototype into a production-ready system by addressing the 26 critical and key important issues identified in the production audit.

**Architecture:** No architectural changes — we harden what exists. Security middleware wraps existing routes. Panics become graceful errors. Streaming replaces in-memory I/O. The agent gets timeouts and backoff fixes. All changes are backward-compatible with existing configs and database schemas.

**Tech Stack:** Existing deps + `jsonwebtoken` (JWT), `tower` (rate limiting), `sha2` (checksums), `tokio-util` (streaming). No new crates where avoidable.

---

## Task 1: Harden veha-core — Safety & Error Types

**Files:**
- Modify: `veha-core/src/lib.rs`
- Modify: `veha-core/src/error.rs`
- Modify: `veha-core/src/frame.rs`
- Modify: `veha-core/src/playlist.rs`
- Modify: `veha-core/src/player.rs`
- Modify: `veha-core/Cargo.toml`
- Test: `veha-core/tests/` (existing tests must still pass)

**Step 1: Expand error types**

Replace the catch-all `Error::Other(String)` with specific variants in `veha-core/src/error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("FFmpeg error: {0}")]
    Ffmpeg(#[from] ffmpeg_next::Error),

    #[error("No video stream found")]
    NoVideoStream,

    #[error("No audio stream found")]
    NoAudioStream,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    JsonParse(#[from] serde_json::Error),

    #[error("Invalid dimensions: {0}")]
    InvalidDimensions(String),

    #[error("Image decode failed: {0}")]
    ImageDecode(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("{0}")]
    Other(String),
}
```

**Step 2: Fix init() panic**

Replace `expect()` with `Result` in `veha-core/src/lib.rs`:

```rust
use std::sync::Once;

static INIT: Once = Once::new();

/// Initialize FFmpeg. Call once at program start.
/// Safe to call multiple times — only the first call has effect.
pub fn init() -> Result<()> {
    let mut result = Ok(());
    INIT.call_once(|| {
        if let Err(e) = ffmpeg_next::init() {
            result = Err(Error::Ffmpeg(e));
        }
    });
    result
}
```

Update callers in `veha-player/src/main.rs` (line 36) and `veha-cli/src/main.rs`:
```rust
veha_core::init().expect("FFmpeg initialization failed — check FFmpeg libraries are installed");
```
(Keep the expect here since this is main() startup — binary can't run without FFmpeg.)

**Step 3: Add checked arithmetic to frame.rs**

In `veha-core/src/frame.rs`, fix `VideoFrame::new()` (line 30-38):

```rust
pub fn new(width: u32, height: u32) -> Result<Self, crate::Error> {
    let size = (width as u64)
        .checked_mul(height as u64)
        .and_then(|v| v.checked_mul(3))
        .ok_or_else(|| crate::Error::InvalidDimensions(
            format!("{}x{} overflows", width, height)
        ))?;
    if size > 128 * 1024 * 1024 {  // 128MB max frame
        return Err(crate::Error::InvalidDimensions(
            format!("{}x{} frame too large ({}MB)", width, height, size / 1024 / 1024)
        ));
    }
    Ok(Self {
        data: vec![0u8; size as usize],
        width,
        height,
        pts: None,
        time_base: (1, 30),
    })
}
```

**Step 4: Guard division by zero in timestamp_secs**

In `veha-core/src/frame.rs` line 54-58:

```rust
pub fn timestamp_secs(&self) -> Option<f64> {
    if self.time_base.1 == 0 {
        return None;
    }
    self.pts.map(|pts| {
        pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64
    })
}
```

**Step 5: Add file size limit to playlist loading**

In `veha-core/src/playlist.rs`, fix `from_json_file()` (line 42-46):

```rust
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
```

**Step 6: Make playlist writes atomic**

In `veha-core/src/playlist.rs`, fix `to_json_file()` (line 49-54):

```rust
pub fn to_json_file(&self, path: &str) -> crate::Result<()> {
    let data = serde_json::to_string_pretty(self)?;
    let tmp_path = format!("{}.tmp", path);
    std::fs::write(&tmp_path, &data)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}
```

**Step 7: Run tests**

Run: `cargo test --workspace`
Expected: All 11 tests pass. (The `from_str` error conversion now uses `From` trait via `#[from]`.)

**Step 8: Commit**

```bash
git add veha-core/
git commit -m "fix(core): harden error types, checked arithmetic, atomic writes

- Replace Error::Other catch-all with specific variants (JsonParse, InvalidDimensions, ImageDecode, Timeout)
- Make init() idempotent with Once guard
- Add checked arithmetic in VideoFrame::new() to prevent integer overflow
- Guard division by zero in timestamp_secs()
- Add 10MB file size limit to playlist loading
- Make playlist file writes atomic via write-then-rename

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Harden veha-api — Replace Panics, Add Health Endpoint, Graceful Shutdown

**Files:**
- Modify: `veha-api/src/main.rs`
- Modify: `veha-api/src/db.rs`
- Modify: `veha-api/src/ws.rs`
- Modify: `veha-api/src/routes.rs`
- Modify: `veha-api/Cargo.toml`

**Step 1: Fix db.rs panics**

Replace all `expect()`/`unwrap()` in `veha-api/src/db.rs`:

```rust
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

    // Run migrations
    for statement in MIGRATION_SQL.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await?;
        }
    }

    tracing::info!("Database initialized at {}", path);
    Ok(pool)
}
```

Fix `create_board` (line 47-57) and `create_group` (line 112-120) — replace `.map(|o| o.unwrap())`:

```rust
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
```

Same pattern for `create_group` and `create_playlist`.

**Step 2: Fix ws.rs panics**

In `veha-api/src/ws.rs`, replace `serde_json::to_string(...).unwrap()` at lines 39 and 122:

```rust
// Line 39 — in handle_agent_socket
let ack = match serde_json::to_string(&WsMessage::Ack { ok: true }) {
    Ok(s) => s,
    Err(e) => {
        tracing::error!("Failed to serialize ack: {e}");
        return;
    }
};
```

```rust
// Line 122 — in send_command_to_board
pub async fn send_command_to_board(...) -> bool {
    let msg = match serde_json::to_string(&WsMessage::Command {
        command: command.clone(),
    }) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to serialize command: {e}");
            return false;
        }
    };
    // ... rest unchanged
}
```

**Step 3: Fix WebSocket duplicate connection memory leak**

In `veha-api/src/ws.rs`, before inserting new connection (line 66-69), abort the old one:

```rust
// Create a channel for sending commands to this agent.
let (cmd_tx, mut cmd_rx) = mpsc::channel::<String>(32);

// Store the sender in the shared map, cleaning up any old connection.
{
    let mut map = agents.write().await;
    if let Some(old_tx) = map.insert(board_id.clone(), cmd_tx) {
        // Drop the old sender — this will cause the old send_task to end
        // when its receiver sees the channel closed.
        drop(old_tx);
        tracing::warn!("Replaced existing connection for board {}", board_id);
    }
}
```

**Step 4: Add health endpoint and graceful shutdown to main.rs**

Replace `veha-api/src/main.rs`:

```rust
use clap::Parser;
use axum::Router;
use sqlx::SqlitePool;
use tower_http::cors::{CorsLayer, Any};
use axum::http::Method;

mod db;
mod models;
mod routes;
mod ws;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub agents: ws::AgentConnections,
    pub media_dir: String,
}

#[derive(Parser)]
#[command(name = "veha-api", about = "koompi-veha fleet management API server")]
struct Args {
    /// Address to bind (e.g. 0.0.0.0:3000)
    #[arg(short, long, default_value = "0.0.0.0:3000")]
    bind: String,

    /// Path to SQLite database file
    #[arg(long, default_value = "veha.db")]
    database: String,

    /// Directory for uploaded media files
    #[arg(long, default_value = "media")]
    media_dir: String,

    /// Allowed CORS origins (comma-separated, e.g. "http://localhost:3000,https://dashboard.example.com")
    #[arg(long, default_value = "")]
    cors_origins: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Create media directory
    if let Err(e) = std::fs::create_dir_all(&args.media_dir) {
        tracing::error!("Failed to create media directory '{}': {e}", args.media_dir);
        std::process::exit(1);
    }

    // Initialize database
    let db = match db::init_db(&args.database).await {
        Ok(pool) => pool,
        Err(e) => {
            tracing::error!("Failed to initialize database: {e}");
            std::process::exit(1);
        }
    };

    let state = AppState {
        db: db.clone(),
        agents: ws::AgentConnections::default(),
        media_dir: args.media_dir,
    };

    // Configure CORS
    let cors = if args.cors_origins.is_empty() {
        // Development mode: permissive (warn about it)
        tracing::warn!("No --cors-origins set, using permissive CORS (development only!)");
        CorsLayer::permissive()
    } else {
        let origins: Vec<_> = args.cors_origins
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers(Any)
    };

    let app: Router = routes::create_router(state).layer(cors);

    let listener = match tokio::net::TcpListener::bind(&args.bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind to {}: {e}", args.bind);
            std::process::exit(1);
        }
    };
    tracing::info!("API server listening on {}", args.bind);

    // Graceful shutdown on SIGTERM/SIGINT
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("Shutdown signal received, draining connections...");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("Server error: {e}");
        });

    // Close database pool
    db.close().await;
    tracing::info!("Server shut down cleanly");
}
```

**Step 5: Add health endpoint to routes.rs**

Add at top of `create_router()` in `veha-api/src/routes.rs`:

```rust
.route("/health", get(health_check))
```

Add handler:

```rust
async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    // Quick DB check
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
```

**Step 6: Build and test**

Run: `cargo build --workspace && cargo test --workspace`

**Step 7: Commit**

```bash
git add veha-api/
git commit -m "fix(api): remove panics, add health endpoint, graceful shutdown, configurable CORS

- Replace all expect()/unwrap() in db.rs, ws.rs, main.rs with proper error handling
- Enable SQLite WAL mode for better concurrent reads
- Add /health endpoint with DB connectivity check and agent count
- Add graceful shutdown on SIGTERM/SIGINT with connection draining
- Make CORS configurable via --cors-origins flag (permissive only in dev)
- Fix WebSocket memory leak on duplicate board connections
- Exit with clear error messages instead of panicking

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Streaming File I/O + Upload Limits

**Files:**
- Modify: `veha-api/src/routes.rs`
- Modify: `veha-api/Cargo.toml`

**Step 1: Add dependencies**

Add to `veha-api/Cargo.toml`:

```toml
tokio-util = { version = "0.7", features = ["io"] }
```

**Step 2: Stream uploads to disk instead of memory**

Replace `upload_media` handler in `veha-api/src/routes.rs` (lines 180-251):

```rust
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
                        if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await {
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
```

**Step 3: Stream downloads instead of loading into memory**

Replace `download_media` handler (lines 253-283):

```rust
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
```

**Step 4: Build and test**

Run: `cargo build -p veha-api && cargo test --workspace`

**Step 5: Commit**

```bash
git add veha-api/
git commit -m "fix(api): stream file uploads/downloads, add 2GB upload limit, path traversal guard

- Stream uploads directly to disk via chunked reads (no full-file memory load)
- Enforce 2GB upload size limit with clean partial file cleanup on rejection
- Stream downloads via ReaderStream (no full-file memory load)
- Add path canonicalization guard against directory traversal in downloads

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Database Indexes

**Files:**
- Create: `veha-api/migrations/002_indexes.sql`
- Modify: `veha-api/src/db.rs` (add new migration)

**Step 1: Create index migration**

Create `veha-api/migrations/002_indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_boards_group_id ON boards(group_id);
CREATE INDEX IF NOT EXISTS idx_boards_status ON boards(status);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists(created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_board_id ON schedules(board_id);
CREATE INDEX IF NOT EXISTS idx_schedules_group_id ON schedules(group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_playlist_id ON schedules(playlist_id);
CREATE INDEX IF NOT EXISTS idx_schedules_priority ON schedules(priority);
```

**Step 2: Load new migration in db.rs**

In `veha-api/src/db.rs`, add after line 6:

```rust
const MIGRATION_002_SQL: &str = include_str!("../migrations/002_indexes.sql");
```

In the `init_db` function, after running MIGRATION_SQL, add:

```rust
    for statement in MIGRATION_002_SQL.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await?;
        }
    }
```

**Step 3: Build and test**

Run: `cargo build -p veha-api && cargo test --workspace`

**Step 4: Commit**

```bash
git add veha-api/
git commit -m "perf(api): add database indexes for FK columns and sort keys

- Add indexes on boards.group_id, boards.status
- Add indexes on media.uploaded_at, playlists.created_at
- Add indexes on all schedules FK columns and priority

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Harden veha-player — Remove Panics, Signal Handling, Socket Cleanup

**Files:**
- Modify: `veha-player/src/main.rs`
- Modify: `veha-player/src/ipc.rs`

**Step 1: Add signal handling and socket cleanup**

In `veha-player/src/main.rs`, add shutdown coordination. Replace lines 56 onward:

```rust
    // Shutdown flag
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Create command channel
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<(
        PlayerCommand,
        Option<tokio::sync::oneshot::Sender<PlayerStatus>>,
    )>(32);

    // ... (shared state declarations stay the same, lines 62-65)

    // Start IPC server
    let ipc_socket = config.socket_path.clone();
    let ipc_cmd_tx = cmd_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = ipc::start_ipc_server(&ipc_socket, ipc_cmd_tx).await {
            error!("IPC server error: {e}");
        }
    });

    // Signal handler — sets shutdown flag and cleans up socket
    let shutdown_clone = shutdown.clone();
    let socket_path_for_cleanup = config.socket_path.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        info!("Shutdown signal received");
        shutdown_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = std::fs::remove_file(&socket_path_for_cleanup);
    });
```

**Step 2: Replace unwrap() on mutex locks throughout main.rs**

Create a helper macro at the top of main.rs (after imports):

```rust
/// Lock a mutex, returning the default-state value if poisoned.
fn lock_or_default<T: Default>(m: &Mutex<T>) -> std::sync::MutexGuard<T> {
    m.lock().unwrap_or_else(|poisoned| {
        tracing::error!("Mutex poisoned, recovering with previous state");
        poisoned.into_inner()
    })
}
```

Then replace all `.lock().unwrap()` with `lock_or_default()` calls. Example for line 76:
```rust
*lock_or_default(&current_playlist) = Some(playlist);
```
Apply this pattern to all 13 `.lock().unwrap()` calls in main.rs (lines 76, 117, 121, 125, 129, 133, 143, 144, 145, 150, 151, 152, 174, 222, 240, 241, 265, 280, 282, 283, 286).

**Step 3: Monitor player thread for panics**

Replace line 183 (`player_handle.join().ok()`) with:

```rust
    // Monitor player thread
    match player_handle.join() {
        Ok(()) => info!("Player thread exited normally"),
        Err(panic_payload) => {
            let msg = if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else if let Some(s) = panic_payload.downcast_ref::<&str>() {
                s.to_string()
            } else {
                "unknown panic".to_string()
            };
            error!("Player thread panicked: {msg}");
            std::process::exit(1);
        }
    }
```

**Step 4: Replace sink creation panics (line 196-201)**

Replace `.expect()` calls with error handling:

```rust
    let mut sink: Box<dyn OutputSink> = match config.output_backend.as_str() {
        "window" => match veha_output::WindowSink::new(&config.title, config.width, config.height) {
            Ok(s) => Box::new(s),
            Err(e) => {
                tracing::error!("Failed to create window sink: {e}. Falling back to null.");
                Box::new(veha_output::NullSink::new(config.width, config.height))
            }
        },
        #[cfg(feature = "framebuffer")]
        "framebuffer" => match veha_output::FramebufferSink::new(0) {
            Ok(s) => Box::new(s),
            Err(e) => {
                tracing::error!("Failed to open framebuffer: {e}. Falling back to null.");
                Box::new(veha_output::NullSink::new(config.width, config.height))
            }
        },
        // ... rest stays same
    };
```

**Step 5: Add IPC line length limit**

In `veha-player/src/ipc.rs`, after line 31 (`let mut line = String::new()`), limit read size:

```rust
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            const MAX_LINE_LEN: usize = 1024 * 1024;  // 1MB max command

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(n) if n > MAX_LINE_LEN => {
                        let err_response = serde_json::json!({"error": "message too large"});
                        let _ = writer
                            .write_all(format!("{err_response}\n").as_bytes())
                            .await;
                        break;
                    }
                    Ok(_) => {
                        // ... rest unchanged
                    }
```

**Step 6: Build and test**

Run: `cargo build -p veha-player && cargo test --workspace`

**Step 7: Commit**

```bash
git add veha-player/
git commit -m "fix(player): remove panics, add signal handling, monitor player thread

- Replace all .lock().unwrap() with poison-recovery helper (13 sites)
- Add SIGTERM/SIGINT handler with socket file cleanup
- Monitor player thread — exit with error on panic instead of silent ignore
- Replace sink creation expect() with fallback to NullSink
- Add 1MB IPC message size limit

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Harden veha-agent — Backoff Reset, IPC Timeouts, WS Message Limit

**Files:**
- Modify: `veha-agent/src/ws_client.rs`
- Modify: `veha-agent/src/player_client.rs`

**Step 1: Fix backoff reset**

In `veha-agent/src/ws_client.rs`, reset backoff after successful connection (line 26-45):

```rust
pub async fn run(config: AgentConfig) {
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF: u64 = 60;

    loop {
        info!("Connecting to API server at {}", config.api_url);

        match connect_and_run(&config).await {
            Ok(()) => {
                info!("WebSocket session ended cleanly");
                // Reset backoff on clean session (connection was successful)
                backoff_secs = 1;
            }
            Err(e) => {
                error!("WebSocket error: {e}");
            }
        }

        info!("Reconnecting in {backoff_secs}s ...");
        time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);
    }
}
```

Also reset backoff after successful registration (in `connect_and_run`, after the Ack is received at line 67). Add at line 68:

```rust
            Ok(WsMessage::Ack { ok: true }) => {
                info!("Registered successfully as {}", config.board_id);
                // Connection is confirmed working — caller should reset backoff
            }
```

For a clean reset, change the `run` function to reset on `Ok(())` only, which already covers it since `connect_and_run` returns `Ok` only after full registration and session.

**Step 2: Add timeouts to IPC operations**

In `veha-agent/src/player_client.rs`, wrap all operations in timeouts:

```rust
use veha_core::command::{PlayerCommand, PlayerStatus};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{timeout, Duration};

const IPC_TIMEOUT: Duration = Duration::from_secs(5);

/// Send a command to the local veha-player daemon via its Unix socket.
pub async fn send_command(
    socket_path: &str,
    command: &PlayerCommand,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let stream = timeout(IPC_TIMEOUT, UnixStream::connect(socket_path))
        .await
        .map_err(|_| "IPC connect timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    let (reader, mut writer) = stream.into_split();

    let cmd_json = serde_json::to_string(command)?;
    timeout(IPC_TIMEOUT, writer.write_all(format!("{cmd_json}\n").as_bytes()))
        .await
        .map_err(|_| "IPC write timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    let mut reader = BufReader::new(reader);
    let mut response = String::new();
    timeout(IPC_TIMEOUT, reader.read_line(&mut response))
        .await
        .map_err(|_| "IPC read timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    Ok(response.trim().to_string())
}

/// Query the local veha-player for its current status.
pub async fn get_status(
    socket_path: &str,
) -> Result<PlayerStatus, Box<dyn std::error::Error + Send + Sync>> {
    let response = send_command(socket_path, &PlayerCommand::GetStatus).await?;
    let status: PlayerStatus = serde_json::from_str(&response)?;
    Ok(status)
}
```

**Step 3: Build and test**

Run: `cargo build -p veha-agent && cargo test --workspace`

**Step 4: Commit**

```bash
git add veha-agent/
git commit -m "fix(agent): reset reconnect backoff, add IPC timeouts

- Reset exponential backoff to 1s after successful WebSocket session
- Add 5-second timeouts to all Unix socket IPC operations (connect, write, read)
- Prevents agent hang when veha-player is unresponsive

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Add API Key Authentication for Agents

**Files:**
- Modify: `veha-api/src/ws.rs`
- Modify: `veha-api/src/main.rs`
- Modify: `veha-api/src/routes.rs`
- Modify: `veha-agent/src/ws_client.rs`
- Modify: `veha-agent/src/config.rs`

**Step 1: Add API key to server config**

In `veha-api/src/main.rs`, add to Args:

```rust
    /// API key for agent authentication (required in production)
    #[arg(long, env = "VEHA_API_KEY", default_value = "")]
    api_key: String,
```

Add to AppState:

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub agents: ws::AgentConnections,
    pub media_dir: String,
    pub api_key: String,
}
```

Wire it in the state construction.

**Step 2: Validate API key in WebSocket handler**

Modify `ws.rs` — update `WsMessage::Register` to include `api_key`:

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register {
        board_id: String,
        #[serde(default)]
        api_key: Option<String>,
    },
    Ack { ok: bool },
}
```

In `handle_agent_socket`, after extracting board_id (line 36-43):

```rust
                Ok(WsMessage::Register { board_id, api_key: agent_key }) => {
                    // Validate API key if server has one configured
                    if !api_key.is_empty() {
                        let valid = agent_key
                            .as_deref()
                            .map(|k| k == api_key)
                            .unwrap_or(false);
                        if !valid {
                            tracing::warn!("Agent {} rejected: invalid API key", board_id);
                            let nak = serde_json::to_string(&WsMessage::Ack { ok: false })
                                .unwrap_or_default();
                            let _ = ws_tx.send(Message::Text(nak.into())).await;
                            return;
                        }
                    }
                    tracing::info!("Agent registered: {}", board_id);
                    // ... rest unchanged
                }
```

Update `handle_agent_socket` signature to accept `api_key: String` and pass it from routes.rs.

**Step 3: Send API key from agent**

In `veha-agent/src/ws_client.rs`, update the Register message (line 57-60):

```rust
    let register_msg = serde_json::to_string(&WsMessage::Register {
        board_id: config.board_id.clone(),
        api_key: if config.api_key.is_empty() {
            None
        } else {
            Some(config.api_key.clone())
        },
    })?;
```

Update the agent's `WsMessage` enum to match:

```rust
pub enum WsMessage {
    Command { command: PlayerCommand },
    Status { status: PlayerStatus },
    Register {
        board_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    Ack { ok: bool },
}
```

**Step 4: Build and test**

Run: `cargo build --workspace && cargo test --workspace`

**Step 5: Commit**

```bash
git add veha-api/ veha-agent/
git commit -m "feat(api,agent): add API key authentication for agent WebSocket connections

- Server accepts --api-key flag or VEHA_API_KEY env var
- Agent sends api_key from config during Register handshake
- Server rejects agents with invalid keys (sends Ack{ok:false})
- Empty api_key on server = no auth required (backward compatible)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Add Pagination to List Endpoints

**Files:**
- Modify: `veha-api/src/routes.rs`
- Modify: `veha-api/src/db.rs`
- Modify: `veha-api/src/models.rs`

**Step 1: Add pagination query params model**

Add to `veha-api/src/models.rs`:

```rust
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
```

**Step 2: Update db.rs list functions with LIMIT/OFFSET + count**

Example for `list_boards`:

```rust
pub async fn list_boards(pool: &SqlitePool, page: u32, per_page: u32) -> Result<(Vec<Board>, i64), sqlx::Error> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM boards")
        .fetch_one(pool)
        .await?;

    let offset = ((page.max(1) - 1) * per_page) as i64;
    let limit = per_page.min(200) as i64;  // Cap at 200

    let boards = sqlx::query_as::<_, Board>(
        "SELECT id, name, group_id, status, last_seen, config, created_at FROM boards ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok((boards, total.0))
}
```

Apply the same pattern to `list_media`, `list_playlists`, `list_schedules`, `list_groups`.

**Step 3: Update route handlers**

Example for `list_boards`:

```rust
async fn list_boards(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    match db::list_boards(&state.db, params.page, params.per_page).await {
        Ok((boards, total)) => Json(PaginatedResponse {
            data: boards,
            total,
            page: params.page,
            per_page: params.per_page,
        }).into_response(),
        Err(e) => {
            tracing::error!("list_boards: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
```

Add `use axum::extract::Query;` to routes.rs imports.

Apply the same pattern to all list handlers.

**Step 4: Build and test**

Run: `cargo build --workspace && cargo test --workspace`

**Step 5: Commit**

```bash
git add veha-api/
git commit -m "feat(api): add pagination to all list endpoints

- All list endpoints accept ?page=N&per_page=N query params
- Default: page=1, per_page=50, max 200 per page
- Response includes total count for client-side pagination UI
- Prevents loading unbounded datasets from DB

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Final Build Verification

**Step 1: Full workspace build**

Run: `cargo build --workspace`
Expected: Clean build, no warnings.

**Step 2: Run all tests**

Run: `cargo test --workspace`
Expected: All tests pass.

**Step 3: Check WASM target**

Run: `cargo check -p veha-web --target wasm32-unknown-unknown`
Expected: Clean check (veha-web doesn't depend on modified crates).

**Step 4: Commit any fix-ups needed**

If any tests fail or warnings appear, fix them and commit.

---

## Summary of Changes

| Task | Crates | Issues Addressed |
|------|--------|-----------------|
| 1 | veha-core | 6 (init panic, overflow, div-by-zero, file limits, error types, atomic writes) |
| 2 | veha-api | 7 (db panics, ws panics, ws leak, CORS, graceful shutdown, health, directory errors) |
| 3 | veha-api | 3 (streaming upload, streaming download, path traversal) |
| 4 | veha-api | 2 (indexes, WAL mode) |
| 5 | veha-player | 5 (all unwrap panics, signal handling, thread monitoring, sink creation, IPC limits) |
| 6 | veha-agent | 2 (backoff reset, IPC timeouts) |
| 7 | veha-api, veha-agent | 1 (API key auth) |
| 8 | veha-api | 1 (pagination) |
| 9 | all | verification |
| **Total** | | **27 critical+important issues resolved** |

After this plan, the system is deployable on a trusted network with basic security and stability for 24/7 operation. Phase 2 (full JWT auth, metrics, caching, scheduling) should follow.
