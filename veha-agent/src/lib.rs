pub mod config;
mod metrics;
mod player_client;
mod terminal;
mod ws_client;

pub use config::AgentConfig;

/// Run the agent loop. Connects to the API server via WebSocket and never
/// returns — reconnects automatically on disconnect.
pub async fn run(config: AgentConfig) {
    tracing::info!(
        "Starting veha-agent board_id={} api={}",
        config.board_id, config.api_url
    );
    ws_client::run(config).await;
}
