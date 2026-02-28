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
#[command(name = "mepl-api", about = "koompi-mepl fleet management API server")]
struct Args {
    /// Address to bind (e.g. 0.0.0.0:3000)
    #[arg(short, long, default_value = "0.0.0.0:3000")]
    bind: String,

    /// Path to SQLite database file
    #[arg(long, default_value = "mepl.db")]
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
