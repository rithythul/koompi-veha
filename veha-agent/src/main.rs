use std::path::Path;

use clap::Parser;
use tracing::{error, info};

mod config;
mod metrics;
mod player_client;
mod terminal;
mod ws_client;

use config::AgentConfig;

#[derive(Parser)]
#[command(name = "veha-agent", about = "koompi-veha board agent — bridges the API server and local player")]
struct Args {
    /// Path to agent config file (TOML)
    #[arg(short, long, default_value = "veha-agent.toml")]
    config: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    let config = if Path::new(&args.config).exists() {
        match AgentConfig::from_file(&args.config) {
            Ok(cfg) => cfg,
            Err(e) => {
                error!("Failed to load config from {}: {e}", args.config);
                std::process::exit(1);
            }
        }
    } else {
        error!(
            "Config file not found: {}. Create a TOML config with at least board_id and api_url.",
            args.config
        );
        std::process::exit(1);
    };

    info!(
        "Starting veha-agent board_id={} api={}",
        config.board_id, config.api_url
    );

    // The ws_client::run loop handles reconnection internally and never returns.
    ws_client::run(config).await;
}
