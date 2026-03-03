pub mod config;
mod metrics;
mod player_client;
mod terminal;
mod ws_client;

pub use config::AgentConfig;

/// Run the agent loop. Connects to the API server via WebSocket and never
/// returns — reconnects automatically on disconnect.
pub async fn run(config: AgentConfig) {
    ws_client::run(config).await;
}
