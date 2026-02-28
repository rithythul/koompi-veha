# DOOH Platform — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform koompi-dooh from a media player fleet manager into a DOOH (Digital Out-of-Home) advertising platform with zones, advertisers, campaigns, bookings, proof-of-play, and session authentication.

**Architecture:** Extend the existing axum + SQLite + WebSocket stack. Add 7 new DB tables via migration, session-based auth middleware, DOOH CRUD endpoints, a server-side schedule resolution engine that pushes resolved playlists to agents, and a revamped vanilla JS dashboard with 5 new pages.

**Tech Stack:** Rust (axum 0.8, sqlx 0.8, argon2, rand), SQLite, vanilla JS + Tailwind CDN.

**Design doc:** `docs/plans/2026-02-28-dooh-platform-design.md`

---

## Task 1: Database Migration — New Tables + Board Extensions

**Files:**
- Create: `dooh-api/migrations/003_dooh.sql`
- Modify: `dooh-api/src/db.rs` (add MIGRATION_003_SQL constant + execution)

**Step 1: Write migration SQL**

Create `dooh-api/migrations/003_dooh.sql` with:

```sql
-- Zones (geographic hierarchy)
CREATE TABLE IF NOT EXISTS zones (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    zone_type   TEXT NOT NULL DEFAULT 'custom',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES zones(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_zones_parent_id ON zones(parent_id);

-- Extend boards with DOOH fields (SQLite ADD COLUMN is safe for existing rows)
-- Each ALTER is idempotent-safe if wrapped in a migration that only runs once.
ALTER TABLE boards ADD COLUMN zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN latitude REAL;
ALTER TABLE boards ADD COLUMN longitude REAL;
ALTER TABLE boards ADD COLUMN address TEXT;
ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'led_billboard';
ALTER TABLE boards ADD COLUMN screen_width INTEGER;
ALTER TABLE boards ADD COLUMN screen_height INTEGER;
ALTER TABLE boards ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE boards ADD COLUMN sell_mode TEXT NOT NULL DEFAULT 'house_only';
ALTER TABLE boards ADD COLUMN operating_hours_start TEXT;
ALTER TABLE boards ADD COLUMN operating_hours_end TEXT;

CREATE INDEX IF NOT EXISTS idx_boards_zone_id ON boards(zone_id);
CREATE INDEX IF NOT EXISTS idx_boards_sell_mode ON boards(sell_mode);

-- Users (session auth)
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Advertisers
CREATE TABLE IF NOT EXISTS advertisers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    is_house      INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id              TEXT PRIMARY KEY,
    advertiser_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (advertiser_id) REFERENCES advertisers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser_id ON campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Creatives (links campaigns to media)
CREATE TABLE IF NOT EXISTS creatives (
    id              TEXT PRIMARY KEY,
    campaign_id     TEXT NOT NULL,
    media_id        TEXT NOT NULL,
    name            TEXT,
    duration_secs   INTEGER,
    status          TEXT NOT NULL DEFAULT 'approved',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_creatives_campaign_id ON creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_creatives_media_id ON creatives(media_id);

-- Bookings (campaign placed on boards/zones)
CREATE TABLE IF NOT EXISTS bookings (
    id                TEXT PRIMARY KEY,
    campaign_id       TEXT NOT NULL,
    booking_type      TEXT NOT NULL,
    target_type       TEXT NOT NULL,
    target_id         TEXT NOT NULL,
    start_date        TEXT NOT NULL,
    end_date          TEXT NOT NULL,
    start_time        TEXT,
    end_time          TEXT,
    days_of_week      TEXT DEFAULT '0,1,2,3,4,5,6',
    slot_duration_secs INTEGER DEFAULT 15,
    slots_per_loop    INTEGER DEFAULT 1,
    priority          INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'confirmed',
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bookings_target ON bookings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Play Logs (proof of play)
CREATE TABLE IF NOT EXISTS play_logs (
    id            TEXT PRIMARY KEY,
    board_id      TEXT NOT NULL,
    booking_id    TEXT,
    creative_id   TEXT,
    media_id      TEXT,
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_secs INTEGER,
    status        TEXT NOT NULL DEFAULT 'played',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE SET NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_play_logs_board_id ON play_logs(board_id);
CREATE INDEX IF NOT EXISTS idx_play_logs_booking_id ON play_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_play_logs_started_at ON play_logs(started_at);

-- Seed house advertiser
INSERT OR IGNORE INTO advertisers (id, name, is_house) VALUES ('house', 'House (PPML)', 1);
```

**Important:** SQLite `ALTER TABLE ADD COLUMN` does NOT support `IF NOT EXISTS`. If this migration runs twice, the ALTER statements will fail. The migration runner in `db.rs` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency, but ALTER TABLE statements are NOT idempotent. Solution: wrap the entire migration 003 execution in a check for whether the `zones` table exists (if it does, skip the migration).

**Step 2: Update db.rs to run migration 003**

In `dooh-api/src/db.rs`, after the `MIGRATION_002_SQL` execution block:

```rust
const MIGRATION_003_SQL: &str = include_str!("../migrations/003_dooh.sql");

// In init_db(), after running migration 002:

// Check if migration 003 already ran (zones table exists)
let zones_exists: (i64,) = sqlx::query_as(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='zones'"
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
```

**Step 3: Build and verify**

Run: `cargo build -p dooh-api`
Expected: compiles clean

Run: `cargo test --workspace`
Expected: all 11 tests pass (migration runs in test DB)

**Step 4: Commit**

```bash
git add dooh-api/migrations/003_dooh.sql dooh-api/src/db.rs
git commit -m "feat(api): add DOOH database schema — zones, advertisers, campaigns, bookings, play_logs, users"
```

---

## Task 2: Session Authentication + Roles

**Files:**
- Modify: `dooh-api/Cargo.toml` (add argon2, rand dependencies)
- Create: `dooh-api/src/auth.rs` (auth module: hashing, sessions, middleware)
- Modify: `dooh-api/src/models.rs` (add User, Session, LoginRequest, AuthResponse models)
- Modify: `dooh-api/src/db.rs` (add user/session CRUD, default admin seeding)
- Modify: `dooh-api/src/routes.rs` (add auth routes, apply middleware)
- Modify: `dooh-api/src/main.rs` (add `mod auth`, seed default admin after DB init)

**Step 1: Add dependencies**

In `dooh-api/Cargo.toml`, add:
```toml
argon2 = "0.5"
rand = "0.8"
```

**Step 2: Create auth module (`dooh-api/src/auth.rs`)**

```rust
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::IntoResponse,
};

use crate::AppState;

/// Hash a password using Argon2.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    use argon2::{Argon2, PasswordHasher};
    use argon2::password_hash::SaltString;
    use rand::rngs::OsRng;

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

/// Verify a password against a hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    use argon2::{Argon2, PasswordVerifier};
    use argon2::password_hash::PasswordHash;

    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

/// Generate a random session ID.
pub fn generate_session_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes) // We'll use uuid instead to avoid hex dep
}

/// Middleware that checks for a valid session cookie.
/// Skips auth for: /health, /api/auth/*, /ws/agent, and static files.
pub async fn require_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> impl IntoResponse {
    let path = request.uri().path();

    // Skip auth for public routes
    if path == "/health"
        || path.starts_with("/api/auth/")
        || path.starts_with("/ws/")
        || !path.starts_with("/api/")
    {
        return next.run(request).await;
    }

    // Extract session token from cookie
    let session_token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .find_map(|c| {
                    let c = c.trim();
                    c.strip_prefix("dooh_session=")
                })
        });

    let token = match session_token {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Not authenticated").into_response(),
    };

    // Validate session in DB
    match crate::db::get_valid_session(&state.db, token).await {
        Ok(Some(_user)) => next.run(request).await,
        Ok(None) => (StatusCode::UNAUTHORIZED, "Session expired").into_response(),
        Err(e) => {
            tracing::error!("Session validation error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
```

Note: `generate_session_id()` should use `uuid::Uuid::new_v4().to_string()` instead of hex to avoid adding a `hex` dependency — the project already has `uuid`.

**Step 3: Add models**

In `dooh-api/src/models.rs`, add:

```rust
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
        Self { id: u.id, username: u.username, role: u.role, created_at: u.created_at }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub expires_at: String,
    pub created_at: String,
}
```

**Step 4: Add user/session DB functions**

In `dooh-api/src/db.rs`, add a new section:

```rust
// ── Auth ────────────────────────────────────────────────────────────
pub async fn get_user_by_username(pool: &SqlitePool, username: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?"
    ).bind(username).fetch_optional(pool).await
}

pub async fn create_user(pool: &SqlitePool, id: &str, username: &str, password_hash: &str, role: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
        .bind(id).bind(username).bind(password_hash).bind(role)
        .execute(pool).await?;
    Ok(())
}

pub async fn user_count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users").fetch_one(pool).await?;
    Ok(row.0)
}

pub async fn create_session(pool: &SqlitePool, id: &str, user_id: &str, expires_at: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(id).bind(user_id).bind(expires_at)
        .execute(pool).await?;
    Ok(())
}

pub async fn get_valid_session(pool: &SqlitePool, session_id: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT u.id, u.username, u.password_hash, u.role, u.created_at \
         FROM sessions s JOIN users u ON s.user_id = u.id \
         WHERE s.id = ? AND s.expires_at > datetime('now')"
    ).bind(session_id).fetch_optional(pool).await
}

pub async fn delete_session(pool: &SqlitePool, session_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE id = ?").bind(session_id).execute(pool).await?;
    Ok(())
}

pub async fn cleanup_expired_sessions(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM sessions WHERE expires_at <= datetime('now')")
        .execute(pool).await?;
    Ok(result.rows_affected())
}
```

**Step 5: Add auth routes**

In `dooh-api/src/routes.rs`, add login/logout/me handlers:

```rust
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

    if !crate::auth::verify_password(&input.password, &user.password_hash) {
        return (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response();
    }

    let session_id = uuid::Uuid::new_v4().to_string();
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
    if let Some(token) = extract_session_token(&headers) {
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
    if let Some(token) = extract_session_token(&headers) {
        if let Ok(Some(user)) = db::get_valid_session(&state.db, token).await {
            return Json(UserResponse::from(user)).into_response();
        }
    }
    StatusCode::UNAUTHORIZED.into_response()
}

fn extract_session_token(headers: &HeaderMap) -> Option<&str> {
    headers.get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| cookies.split(';').find_map(|c| c.trim().strip_prefix("dooh_session=")))
}
```

Register auth routes in `create_router()`:
```rust
.route("/api/auth/login", post(login))
.route("/api/auth/logout", post(logout))
.route("/api/auth/me", get(auth_me))
```

Apply auth middleware:
```rust
use axum::middleware;
// In create_router, wrap the API routes with middleware:
.layer(middleware::from_fn_with_state(state.clone(), crate::auth::require_auth))
```

**Step 6: Seed default admin on first boot**

In `dooh-api/src/main.rs`, after `db::init_db()`:

```rust
// Seed default admin if no users exist
match db::user_count(&db).await {
    Ok(0) => {
        let password = uuid::Uuid::new_v4().to_string().replace("-", "")[..16].to_string();
        match auth::hash_password(&password) {
            Ok(hash) => {
                let id = uuid::Uuid::new_v4().to_string();
                if let Err(e) = db::create_user(&db, &id, "admin", &hash, "admin").await {
                    tracing::error!("Failed to create default admin: {e}");
                } else {
                    tracing::info!("=== Default admin created ===");
                    tracing::info!("Username: admin");
                    tracing::info!("Password: {password}");
                    tracing::info!("Change this password after first login!");
                }
            }
            Err(e) => tracing::error!("Failed to hash password: {e}"),
        }
    }
    Err(e) => tracing::error!("Failed to check user count: {e}"),
    _ => {} // Users exist, skip seeding
}
```

**Step 7: Build, test, commit**

Run: `cargo build --workspace && cargo test --workspace`

```bash
git add dooh-api/
git commit -m "feat(api): add session authentication with admin/operator/viewer roles"
```

---

## Task 3: Zone CRUD Endpoints

**Files:**
- Modify: `dooh-api/src/models.rs` (Zone, CreateZone models)
- Modify: `dooh-api/src/db.rs` (zone CRUD functions)
- Modify: `dooh-api/src/routes.rs` (zone handlers + route registration)

**Step 1: Add models**

```rust
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
fn default_zone_type() -> String { "custom".to_string() }

#[derive(Debug, Clone, Serialize)]
pub struct ZoneDetail {
    #[serde(flatten)]
    pub zone: Zone,
    pub children: Vec<Zone>,
    pub board_count: i64,
}
```

**Step 2: Add DB functions**

```rust
// ── Zones ───────────────────────────────────────────────────────────
pub async fn list_zones(pool: &SqlitePool) -> Result<Vec<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>("SELECT id, name, parent_id, zone_type, created_at FROM zones ORDER BY name")
        .fetch_all(pool).await
}

pub async fn get_zone(pool: &SqlitePool, id: &str) -> Result<Option<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>("SELECT id, name, parent_id, zone_type, created_at FROM zones WHERE id = ?")
        .bind(id).fetch_optional(pool).await
}

pub async fn get_zone_children(pool: &SqlitePool, parent_id: &str) -> Result<Vec<Zone>, sqlx::Error> {
    sqlx::query_as::<_, Zone>("SELECT id, name, parent_id, zone_type, created_at FROM zones WHERE parent_id = ? ORDER BY name")
        .bind(parent_id).fetch_all(pool).await
}

pub async fn get_zone_board_count(pool: &SqlitePool, zone_id: &str) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM boards WHERE zone_id = ?")
        .bind(zone_id).fetch_one(pool).await?;
    Ok(row.0)
}

pub async fn create_zone(pool: &SqlitePool, id: &str, input: &CreateZone) -> Result<Zone, sqlx::Error> {
    sqlx::query("INSERT INTO zones (id, name, parent_id, zone_type) VALUES (?, ?, ?, ?)")
        .bind(id).bind(&input.name).bind(&input.parent_id).bind(&input.zone_type)
        .execute(pool).await?;
    get_zone(pool, id).await?.ok_or(sqlx::Error::RowNotFound)
}

pub async fn update_zone(pool: &SqlitePool, id: &str, input: &CreateZone) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE zones SET name = ?, parent_id = ?, zone_type = ? WHERE id = ?")
        .bind(&input.name).bind(&input.parent_id).bind(&input.zone_type).bind(id)
        .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_zone(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM zones WHERE id = ?").bind(id).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}
```

**Step 3: Add route handlers and register routes**

Add handlers following the existing pattern (State, Path/Json extractors, error tracing). Register in `create_router()`:

```rust
.route("/api/zones", get(list_zones).post(create_zone))
.route("/api/zones/{id}", get(get_zone_detail).put(update_zone).delete(delete_zone_handler))
```

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add zone CRUD endpoints for geographic hierarchy"
```

---

## Task 4: Advertiser CRUD Endpoints

**Files:**
- Modify: `dooh-api/src/models.rs`
- Modify: `dooh-api/src/db.rs`
- Modify: `dooh-api/src/routes.rs`

**Step 1: Add models**

```rust
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
```

**Step 2: Add DB functions (paginated list, get, create, update, delete)**

Follow the same paginated pattern as `list_boards()`. Query:
```sql
SELECT id, name, contact_name, contact_email, contact_phone, is_house, notes, created_at
FROM advertisers ORDER BY created_at DESC LIMIT ? OFFSET ?
```

**Step 3: Add route handlers and register**

```rust
.route("/api/advertisers", get(list_advertisers).post(create_advertiser))
.route("/api/advertisers/{id}", get(get_advertiser).put(update_advertiser).delete(delete_advertiser_handler))
```

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add advertiser CRUD endpoints"
```

---

## Task 5: Campaign + Creative CRUD Endpoints

**Files:**
- Modify: `dooh-api/src/models.rs`
- Modify: `dooh-api/src/db.rs`
- Modify: `dooh-api/src/routes.rs`

**Step 1: Add models**

```rust
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
    #[serde(default)]
    pub advertiser_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}

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
```

**Step 2: Add DB functions**

Campaign list with filters:
```rust
pub async fn list_campaigns(pool: &SqlitePool, filter: &CampaignFilter) -> Result<(Vec<Campaign>, i64), sqlx::Error> {
    // Build dynamic WHERE clause based on filter fields
    let mut where_clauses = Vec::new();
    if filter.advertiser_id.is_some() { where_clauses.push("advertiser_id = ?"); }
    if filter.status.is_some() { where_clauses.push("status = ?"); }

    let where_str = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    // ... bind parameters dynamically, execute count + paginated select
}
```

Creative CRUD: `list_creatives_by_campaign`, `create_creative`, `delete_creative`.

Campaign status transitions: `activate_campaign`, `pause_campaign` (simple SET status = ? WHERE id = ?).

**Step 3: Add route handlers and register**

```rust
.route("/api/campaigns", get(list_campaigns).post(create_campaign))
.route("/api/campaigns/{id}", get(get_campaign).put(update_campaign).delete(delete_campaign_handler))
.route("/api/campaigns/{id}/activate", post(activate_campaign))
.route("/api/campaigns/{id}/pause", post(pause_campaign))
.route("/api/campaigns/{id}/creatives", get(list_creatives).post(create_creative))
.route("/api/creatives/{id}", delete(delete_creative_handler))
```

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add campaign and creative CRUD endpoints"
```

---

## Task 6: Booking CRUD Endpoints

**Files:**
- Modify: `dooh-api/src/models.rs`
- Modify: `dooh-api/src/db.rs`
- Modify: `dooh-api/src/routes.rs`

**Step 1: Add models**

```rust
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
    pub booking_type: String,        // "rotation" | "exclusive"
    pub target_type: String,         // "board" | "zone" | "group"
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
    #[serde(default)]
    pub campaign_id: Option<String>,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_per_page")]
    pub per_page: u32,
}
```

**Step 2: Add DB functions**

Paginated `list_bookings` with filters. `create_booking` with input validation (booking_type must be "rotation" or "exclusive", target_type must be "board"/"zone"/"group"). `get_booking`, `update_booking`, `delete_booking`.

**Step 3: Add route handlers and register**

```rust
.route("/api/bookings", get(list_bookings).post(create_booking))
.route("/api/bookings/{id}", get(get_booking).put(update_booking).delete(delete_booking_handler))
```

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add booking CRUD endpoints for timeslot management"
```

---

## Task 7: Schedule Resolution Engine

**Files:**
- Create: `dooh-api/src/resolver.rs` (schedule resolution logic)
- Modify: `dooh-api/src/db.rs` (add query functions for resolution)
- Modify: `dooh-api/src/routes.rs` (add resolved-schedule preview endpoint)
- Modify: `dooh-api/src/main.rs` (add `mod resolver`)

**Step 1: Add DB query functions for resolution**

```rust
/// Get all active bookings that target a specific board (direct, via zone ancestry, or via group).
pub async fn get_active_bookings_for_board(
    pool: &SqlitePool,
    board_id: &str,
    zone_ids: &[String],  // board's zone + all ancestor zone IDs
    group_id: Option<&str>,
    today: &str,           // YYYY-MM-DD
    current_time: &str,    // HH:MM
    day_of_week: u8,       // 0-6
) -> Result<Vec<Booking>, sqlx::Error> {
    // Build query:
    // SELECT * FROM bookings WHERE
    //   status IN ('confirmed', 'active')
    //   AND start_date <= ? AND end_date >= ?
    //   AND (start_time IS NULL OR start_time <= ?)
    //   AND (end_time IS NULL OR end_time >= ?)
    //   AND (
    //     (target_type = 'board' AND target_id = ?)
    //     OR (target_type = 'zone' AND target_id IN (...))
    //     OR (target_type = 'group' AND target_id = ?)
    //   )
    // ORDER BY priority DESC, created_at ASC
    // ... then filter days_of_week in Rust (SQLite lacks array functions)
}

/// Get zone ancestry (zone + parent + grandparent...) for a board's zone_id.
pub async fn get_zone_ancestry(pool: &SqlitePool, zone_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let mut ids = vec![zone_id.to_string()];
    let mut current = zone_id.to_string();
    loop {
        let zone = get_zone(pool, &current).await?;
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

/// Get approved creatives for a campaign.
pub async fn get_approved_creatives(pool: &SqlitePool, campaign_id: &str) -> Result<Vec<Creative>, sqlx::Error> {
    sqlx::query_as::<_, Creative>(
        "SELECT id, campaign_id, media_id, name, duration_secs, status, created_at \
         FROM creatives WHERE campaign_id = ? AND status = 'approved' ORDER BY created_at"
    ).bind(campaign_id).fetch_all(pool).await
}
```

**Step 2: Create resolver module (`dooh-api/src/resolver.rs`)**

```rust
use crate::db;
use crate::models::*;
use dooh_core::{MediaItem, Playlist};
use sqlx::SqlitePool;

/// Resolve what a board should play right now.
pub async fn resolve_for_board(
    pool: &SqlitePool,
    board: &Board,
) -> Result<(Playlist, Vec<String>), Box<dyn std::error::Error>> {
    // 1. If house_only, fall back to existing schedule system
    let sell_mode = board_sell_mode(board);
    if sell_mode == "house_only" {
        return resolve_house_only(pool, board).await;
    }

    let now = chrono::Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let current_time = now.format("%H:%M").to_string();
    let day_of_week = now.format("%w").to_string().parse::<u8>().unwrap_or(0);

    // 2. Get zone ancestry
    let zone_ids = match &board.zone_id {
        Some(zid) => db::get_zone_ancestry(pool, zid).await.unwrap_or_default(),
        None => vec![],
    };

    // 3. Get active bookings
    let bookings = db::get_active_bookings_for_board(
        pool, &board.id, &zone_ids, board.group_id.as_deref(),
        &today, &current_time, day_of_week,
    ).await?;

    if bookings.is_empty() {
        return resolve_house_only(pool, board).await;
    }

    // 4. Build playlist from bookings
    let mut items = Vec::new();
    let mut booking_ids = Vec::new();

    // Check for exclusive bookings (highest priority exclusive wins)
    let exclusive = bookings.iter().find(|b| b.booking_type == "exclusive");

    if let Some(excl) = exclusive {
        let creatives = db::get_approved_creatives(pool, &excl.campaign_id).await?;
        for c in &creatives {
            let media = db::get_media(pool, &c.media_id).await?;
            if let Some(m) = media {
                let duration = c.duration_secs.map(|s| std::time::Duration::from_secs(s as u64));
                items.push(MediaItem {
                    source: format!("/api/media/{}/download", m.id),
                    name: Some(c.name.clone().unwrap_or(m.name.clone())),
                    duration,
                });
            }
        }
        booking_ids.push(excl.id.clone());
    } else {
        // Rotation: build weighted loop
        for booking in &bookings {
            if booking.booking_type != "rotation" { continue; }
            let creatives = db::get_approved_creatives(pool, &booking.campaign_id).await?;
            let slot_dur = std::time::Duration::from_secs(booking.slot_duration_secs as u64);

            for _ in 0..booking.slots_per_loop {
                for c in &creatives {
                    let media = db::get_media(pool, &c.media_id).await?;
                    if let Some(m) = media {
                        let duration = c.duration_secs
                            .map(|s| std::time::Duration::from_secs(s as u64))
                            .or(Some(slot_dur));
                        items.push(MediaItem {
                            source: format!("/api/media/{}/download", m.id),
                            name: Some(c.name.clone().unwrap_or(m.name.clone())),
                            duration,
                        });
                    }
                }
            }
            booking_ids.push(booking.id.clone());
        }
    }

    let playlist = Playlist {
        name: format!("resolved-{}", board.id),
        items,
        loop_playlist: true,
    };

    Ok((playlist, booking_ids))
}

fn board_sell_mode(board: &Board) -> &str {
    // sell_mode is in the extended board columns; access via config or direct field
    // depending on how we model it in the Board struct
    "house_only" // placeholder until Board struct is extended
}

async fn resolve_house_only(
    pool: &SqlitePool,
    board: &Board,
) -> Result<(Playlist, Vec<String>), Box<dyn std::error::Error>> {
    // Fall back to existing schedule/playlist system
    // Find highest-priority schedule matching this board, load its playlist
    // For now, return an empty playlist
    Ok((Playlist { name: "house".into(), items: vec![], loop_playlist: true }, vec![]))
}
```

**Step 3: Add preview endpoint**

In routes.rs:
```rust
.route("/api/boards/{id}/resolved-schedule", get(get_resolved_schedule))
```

Handler calls `resolver::resolve_for_board()` and returns the playlist JSON.

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add schedule resolution engine for DOOH bookings"
```

---

## Task 8: WebSocket Protocol Extensions

**Files:**
- Modify: `dooh-api/src/ws.rs` (add ScheduleUpdate, PlayReport message types)
- Modify: `dooh-agent/src/ws_client.rs` (add matching message types, handle ScheduleUpdate)
- Modify: `dooh-core/src/command.rs` (extend PlayerStatus with optional DOOH fields)

**Step 1: Extend WsMessage on both sides**

Add to the WsMessage enum in both `dooh-api/src/ws.rs` and `dooh-agent/src/ws_client.rs`:

```rust
ScheduleUpdate {
    playlist: String,
    active_booking_ids: Vec<String>,
},
PlayReport {
    booking_id: Option<String>,
    creative_id: Option<String>,
    media_id: Option<String>,
    started_at: String,
    ended_at: String,
    duration_secs: u32,
    status: String,
},
```

**Step 2: Extend PlayerStatus**

In `dooh-core/src/command.rs`, add optional fields (backward compatible via serde defaults):

```rust
pub struct PlayerStatus {
    pub state: String,
    pub current_item: Option<String>,
    pub current_index: usize,
    pub total_items: usize,
    pub playlist_name: Option<String>,
    #[serde(default)]
    pub active_booking_id: Option<String>,
    #[serde(default)]
    pub active_creative_id: Option<String>,
    #[serde(default)]
    pub uptime_secs: Option<u64>,
}
```

**Step 3: Handle ScheduleUpdate in agent**

In `dooh-agent/src/ws_client.rs`, in `handle_server_message()`:

```rust
Ok(WsMessage::ScheduleUpdate { playlist, active_booking_ids }) => {
    info!("Received schedule update with {} active bookings", active_booking_ids.len());
    // Forward as LoadPlaylist command to the local player
    let command = PlayerCommand::LoadPlaylist(playlist);
    match player_client::send_command(socket_path, &command).await {
        Ok(resp) => debug!("Player loaded schedule: {resp}"),
        Err(e) => error!("Failed to load schedule: {e}"),
    }
    // TODO: store active_booking_ids for proof-of-play attribution
}
```

**Step 4: Handle PlayReport on server**

In `dooh-api/src/ws.rs`, in the message receive loop:

```rust
Ok(WsMessage::PlayReport { booking_id, creative_id, media_id, started_at, ended_at, duration_secs, status }) => {
    if let Err(e) = crate::db::insert_play_log(
        &db_clone, &bid, booking_id.as_deref(), creative_id.as_deref(),
        media_id.as_deref(), &started_at, Some(&ended_at), Some(duration_secs as i32), &status,
    ).await {
        tracing::error!("Failed to insert play log from {}: {e}", bid);
    }
}
```

**Step 5: Add schedule push on agent reconnect**

In `handle_agent_socket()`, after the upsert_board call, resolve and push the board's schedule:

```rust
// Push resolved schedule to newly connected agent
if let Ok(Some(board)) = crate::db::get_board(&db, &board_id).await {
    match crate::resolver::resolve_for_board(&db, &board).await {
        Ok((playlist, booking_ids)) => {
            if !playlist.items.is_empty() {
                let playlist_json = serde_json::to_string(&playlist).unwrap_or_default();
                let msg = serde_json::to_string(&WsMessage::ScheduleUpdate {
                    playlist: playlist_json,
                    active_booking_ids: booking_ids,
                }).unwrap_or_default();
                let _ = cmd_tx.send(msg).await;
            }
        }
        Err(e) => tracing::error!("Failed to resolve schedule for {board_id}: {e}"),
    }
}
```

**Step 6: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/ dooh-agent/ dooh-core/
git commit -m "feat(api,agent): add ScheduleUpdate and PlayReport WebSocket messages"
```

---

## Task 9: Play Log Ingestion + Query Endpoints

**Files:**
- Modify: `dooh-api/src/db.rs` (insert_play_log, list_play_logs, play_log_summary)
- Modify: `dooh-api/src/models.rs` (PlayLog, PlayLogFilter, PlayLogSummary)
- Modify: `dooh-api/src/routes.rs` (play log list + summary endpoints)

**Step 1: Add models**

```rust
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
    #[serde(default)]
    pub board_id: Option<String>,
    #[serde(default)]
    pub booking_id: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
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
```

**Step 2: Add DB functions**

```rust
pub async fn insert_play_log(
    pool: &SqlitePool, board_id: &str, booking_id: Option<&str>,
    creative_id: Option<&str>, media_id: Option<&str>,
    started_at: &str, ended_at: Option<&str>, duration_secs: Option<i32>, status: &str,
) -> Result<(), sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO play_logs (id, board_id, booking_id, creative_id, media_id, started_at, ended_at, duration_secs, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(&id).bind(board_id).bind(booking_id).bind(creative_id).bind(media_id)
     .bind(started_at).bind(ended_at).bind(duration_secs).bind(status)
     .execute(pool).await?;
    Ok(())
}

pub async fn list_play_logs(pool: &SqlitePool, filter: &PlayLogFilter) -> Result<(Vec<PlayLog>, i64), sqlx::Error> {
    // Dynamic WHERE + pagination, same pattern as campaigns
}

pub async fn play_log_summary(pool: &SqlitePool, start_date: &str, end_date: &str) -> Result<Vec<PlayLogSummary>, sqlx::Error> {
    sqlx::query_as::<_, PlayLogSummary>(
        "SELECT date(started_at) as date, board_id, booking_id, COUNT(*) as play_count, \
         COALESCE(SUM(duration_secs), 0) as total_duration_secs \
         FROM play_logs WHERE date(started_at) BETWEEN ? AND ? \
         GROUP BY date(started_at), board_id, booking_id \
         ORDER BY date DESC, play_count DESC"
    ).bind(start_date).bind(end_date).fetch_all(pool).await
}
```

**Step 3: Add route handlers and register**

```rust
.route("/api/play-logs", get(list_play_logs))
.route("/api/play-logs/summary", get(play_log_summary))
.route("/api/bookings/{id}/play-logs", get(booking_play_logs))
```

**Step 4: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api): add play log ingestion and query endpoints"
```

---

## Task 10: Dashboard — Fix Pagination + New Pages

**Files:**
- Modify: `dooh-api/static/app.js` (fix existing pages for paginated responses, add new page functions)
- Modify: `dooh-api/static/index.html` (add new page sections + sidebar nav items)
- Modify: `dooh-api/static/style.css` (any new styles needed)

**Step 1: Fix paginated response handling**

All existing `loadBoards()`, `loadMedia()`, `loadPlaylists()`, `loadSchedules()` functions call `api('/api/boards')` etc. and expect bare arrays. After Task 8 of production hardening, these return `{ data: [...], total, page, per_page }`.

Fix each: change `boards = results[0]` to `boards = results[0].data` (or `results[0].data || results[0]` for backward compat during dev).

**Step 2: Add login page/flow**

Before loading any dashboard page, check `GET /api/auth/me`. If 401, show a login form overlay. On successful login, store user info and show the dashboard.

```javascript
async function checkAuth() {
    try {
        const user = await api('/api/auth/me');
        window.currentUser = user;
        document.getElementById('login-overlay').classList.add('hidden');
        navigateTo('dashboard');
    } catch {
        document.getElementById('login-overlay').classList.remove('hidden');
    }
}
```

**Step 3: Add sidebar nav items for new pages**

In index.html, add nav-items for: Dashboard, Zones, Advertisers, Campaigns, Bookings, Play Logs.

**Step 4: Add page sections in HTML**

For each new page (dashboard, zones, advertisers, campaigns, bookings, play-logs), add a `<div id="page-{name}" class="page-content hidden">` with loading spinner and content area.

**Step 5: Add page JS functions**

For each new page, implement `loadXxx()` and rendering functions following the existing pattern. Key pages:

- **Dashboard overview**: `GET /api/boards?per_page=1` (for total), `GET /api/campaigns?status=active&per_page=1`, `GET /api/play-logs/summary?start_date=today&end_date=today`
- **Zones**: tree rendering with expandable nodes
- **Advertisers**: table with CRUD modal
- **Campaigns**: table with create flow (name + advertiser + dates), creative management sub-view
- **Bookings**: table with create flow (campaign + target + time config)
- **Play Logs**: table with date/board/advertiser filters

**Step 6: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/static/
git commit -m "feat(dashboard): add login, overview, zones, advertisers, campaigns, bookings, play logs pages"
```

---

## Task 11: Enhanced Boards Page + Board Update Endpoint

**Files:**
- Modify: `dooh-api/src/models.rs` (UpdateBoard model with DOOH fields)
- Modify: `dooh-api/src/db.rs` (update_board function, extend Board struct query columns)
- Modify: `dooh-api/src/routes.rs` (PUT /api/boards/{id} handler, extend list_boards filters)
- Modify: `dooh-api/static/app.js` (enhanced board table + detail view)

**Step 1: Extend Board struct**

In `dooh-api/src/models.rs`, add the new columns to the Board struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub status: String,
    pub last_seen: Option<String>,
    pub config: String,
    pub created_at: String,
    // DOOH extensions
    pub zone_id: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub address: Option<String>,
    pub board_type: String,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
    pub orientation: String,
    pub sell_mode: String,
    pub operating_hours_start: Option<String>,
    pub operating_hours_end: Option<String>,
}
```

Add UpdateBoard:
```rust
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateBoard {
    pub name: Option<String>,
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
```

**Step 2: Update all board queries to select all columns**

Every SQL query that selects board columns needs the new columns added. The easiest approach: update the `list_boards`, `get_board`, `get_boards_by_group`, and `create_board` queries to include all 18 columns.

**Step 3: Add `update_board` DB function + route handler**

```rust
pub async fn update_board(pool: &SqlitePool, id: &str, input: &UpdateBoard) -> Result<bool, sqlx::Error> {
    // Build SET clause dynamically from non-None fields
}
```

Register route:
```rust
.route("/api/boards/{id}", get(get_board).put(update_board_handler))
```

**Step 4: Add board list filters**

Extend `list_boards` to accept optional `zone_id`, `sell_mode`, `status` filters via query params (new `BoardFilter` struct).

**Step 5: Enhance dashboard boards page**

Update the boards table to show Zone, Sell Mode, Resolution columns. Update the detail modal to show location, screen specs, and active bookings.

**Step 6: Build, test, commit**

```bash
cargo build --workspace && cargo test --workspace
git add dooh-api/
git commit -m "feat(api,dashboard): enhance boards with DOOH fields, location, sell mode"
```

---

## Final Verification

After all 11 tasks:

```bash
cargo build --workspace
cargo test --workspace
cargo check -p dooh-web --target wasm32-unknown-unknown
```

All must pass. Then review the full commit log and verify the dashboard works end-to-end by starting the server and testing in a browser.
