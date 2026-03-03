use std::path::Path;

use clap::Parser;
use tracing::error;

use veha_agent::AgentConfig;

#[derive(Parser)]
#[command(name = "veha-agent", about = "koompi-veha board agent")]
struct Args {
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

    veha_agent::run(config).await;
}
