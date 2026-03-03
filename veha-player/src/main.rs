use clap::Parser;
use veha_player::PlayerConfig;

#[derive(Parser)]
#[command(name = "veha-player", about = "koompi-veha headless player daemon")]
struct Args {
    /// Path to config file (TOML)
    #[arg(short, long, default_value = "veha-player.toml")]
    config: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    veha_core::init().expect("FFmpeg initialization failed — check FFmpeg libraries are installed");

    let args = Args::parse();

    let config = if std::path::Path::new(&args.config).exists() {
        PlayerConfig::from_file(&args.config).unwrap_or_else(|e| {
            tracing::error!("Failed to load config: {e}, using defaults");
            PlayerConfig::default()
        })
    } else {
        tracing::info!("No config file found at {}, using defaults", args.config);
        PlayerConfig::default()
    };

    veha_player::run(config).await;
}
