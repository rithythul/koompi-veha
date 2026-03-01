use clap::Parser;
use axum::Router;
use sqlx::SqlitePool;
use tower_http::cors::{CorsLayer, Any};
use axum::http::Method;

mod auth;
mod db;
mod models;
mod resolver;
mod routes;
mod ws;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub agents: ws::AgentConnections,
    pub dashboards: ws::DashboardConnections,
    pub media_dir: String,
    pub api_key: String,
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

    /// API key for agent authentication (required in production)
    #[arg(long, env = "VEHA_API_KEY", default_value = "")]
    api_key: String,
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

    // Seed default admin if no users exist
    match db::user_count(&db).await {
        Ok(0) => {
            let password = uuid::Uuid::new_v4()
                .to_string()
                .replace('-', "")
                .chars()
                .take(16)
                .collect::<String>();
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

    let state = AppState {
        db: db.clone(),
        agents: ws::AgentConnections::default(),
        dashboards: ws::DashboardConnections::default(),
        media_dir: args.media_dir,
        api_key: args.api_key,
    };

    // Configure CORS
    let cors = if args.cors_origins.is_empty() {
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

    // Background task: clean up expired sessions every hour
    let cleanup_db = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        interval.tick().await; // skip immediate first tick
        loop {
            interval.tick().await;
            match db::cleanup_expired_sessions(&cleanup_db).await {
                Ok(n) if n > 0 => tracing::info!("Cleaned up {n} expired sessions"),
                Err(e) => tracing::error!("Session cleanup failed: {e}"),
                _ => {}
            }
        }
    });

    // Background task: expire completed campaigns every hour
    let expiry_db = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        interval.tick().await;
        loop {
            interval.tick().await;
            match db::expire_campaigns(&expiry_db).await {
                Ok(n) if n > 0 => tracing::info!("Expired {n} campaigns past end_date"),
                Err(e) => tracing::error!("Campaign expiry failed: {e}"),
                _ => {}
            }
        }
    });

    // Background task: check for offline boards + expiring campaigns every 5 minutes
    let alerts_db = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        interval.tick().await;
        loop {
            interval.tick().await;
            match db::create_offline_alerts(&alerts_db).await {
                Ok(n) if n > 0 => tracing::info!("Created {n} offline board alerts"),
                Err(e) => tracing::error!("Offline alert check failed: {e}"),
                _ => {}
            }
            match db::create_campaign_expiring_alerts(&alerts_db).await {
                Ok(n) if n > 0 => tracing::info!("Created {n} campaign expiring alerts"),
                Err(e) => tracing::error!("Campaign expiring alert check failed: {e}"),
                _ => {}
            }
        }
    });

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
