mod config;
mod install;
mod run;
mod status;
mod update;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "veha-edge",
    about = "koompi-veha edge device — agent + player in one binary",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// First-time device setup: install binary, config, and systemd service.
    Install,
    /// Remove the systemd service, config, and binary.
    Uninstall {
        /// Also remove the media cache at /var/cache/veha.
        #[arg(long)]
        purge: bool,
    },
    /// Main runtime entry point (used by systemd). Runs agent + supervises player.
    Run,
    /// Player-only entry point (spawned by `run` as a subprocess).
    Player {
        #[arg(short, long, default_value = "/etc/veha/veha-edge.toml")]
        config: String,
    },
    /// Download and install the latest veha-edge release from GitHub.
    Update,
    /// Show current service and player status.
    Status,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Command::Install => install::run(),
        Command::Uninstall { purge } => install::uninstall(purge),
        Command::Run => run::run().await,
        Command::Player { config } => run::player(&config).await,
        Command::Update => update::run(),
        Command::Status => status::run(),
    }
}
