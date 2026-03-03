use std::path::{Path, PathBuf};
use std::time::Duration;

use tracing::{error, info, warn};

use crate::config::EdgeConfig;

const CONFIG_PATH: &str = "/etc/veha/veha-edge.toml";

/// Main runtime entry point. Loads config, then concurrently runs the agent
/// and supervises the player subprocess.
pub async fn run() {
    let config = load_config(CONFIG_PATH);
    let agent_config = veha_agent::AgentConfig::from(&config);
    let exe = std::env::current_exe().expect("cannot resolve current exe path");
    let restart_delay = Duration::from_secs(config.player_restart_delay_secs);

    tokio::join!(
        supervise_player(exe, CONFIG_PATH.to_string(), restart_delay),
        veha_agent::run(agent_config),
    );
}

/// Player-only entry point, spawned by `run` as a child subprocess.
pub async fn player(config_path: &str) {
    let config = load_config(config_path);
    let player_config = veha_player::PlayerConfig::from(&config);

    veha_core::init().expect("FFmpeg initialization failed — check FFmpeg libraries are installed");
    veha_player::run(player_config).await;
}

fn load_config(path: &str) -> EdgeConfig {
    if Path::new(path).exists() {
        EdgeConfig::from_file(path).unwrap_or_else(|e| {
            error!("Failed to load config from {path}: {e}");
            std::process::exit(1);
        })
    } else {
        error!("Config file not found: {path}. Run `veha-edge install` first.");
        std::process::exit(1);
    }
}

/// Supervisor loop: spawns the player subprocess and restarts it if it exits.
async fn supervise_player(exe: PathBuf, config_path: String, restart_delay: Duration) {
    loop {
        info!("Starting player subprocess");

        let result = tokio::process::Command::new(&exe)
            .args(["player", "--config", &config_path])
            .status()
            .await;

        match result {
            Ok(status) if status.success() => {
                info!(
                    "Player exited cleanly — restarting in {}s",
                    restart_delay.as_secs()
                );
            }
            Ok(status) => {
                warn!(
                    "Player exited with status {} — restarting in {}s",
                    status,
                    restart_delay.as_secs()
                );
            }
            Err(e) => {
                error!(
                    "Failed to spawn player: {e} — retrying in {}s",
                    restart_delay.as_secs()
                );
            }
        }

        tokio::time::sleep(restart_delay).await;
    }
}
