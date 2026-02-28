use clap::Parser;
use axum::Router;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

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
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Create media directory if it doesn't exist.
    std::fs::create_dir_all(&args.media_dir).ok();

    // Initialize database.
    let db = db::init_db(&args.database).await;

    let state = AppState {
        db,
        agents: ws::AgentConnections::default(),
        media_dir: args.media_dir,
    };

    let app: Router = routes::create_router(state).layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(&args.bind).await.unwrap();
    tracing::info!("API server listening on {}", args.bind);
    axum::serve(listener, app).await.unwrap();
}
