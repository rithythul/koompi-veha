use dooh_core::command::{PlayerCommand, PlayerStatus};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::{timeout, Duration};

const IPC_TIMEOUT: Duration = Duration::from_secs(5);

/// Send a command to the local dooh-player daemon via its Unix socket.
/// Returns the raw JSON response string.
pub async fn send_command(
    socket_path: &str,
    command: &PlayerCommand,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let stream = timeout(IPC_TIMEOUT, UnixStream::connect(socket_path))
        .await
        .map_err(|_| "IPC connect timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    let (reader, mut writer) = stream.into_split();

    let cmd_json = serde_json::to_string(command)?;
    timeout(IPC_TIMEOUT, writer.write_all(format!("{cmd_json}\n").as_bytes()))
        .await
        .map_err(|_| "IPC write timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    let mut reader = BufReader::new(reader);
    let mut response = String::new();
    timeout(IPC_TIMEOUT, reader.read_line(&mut response))
        .await
        .map_err(|_| "IPC read timeout")?
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

    Ok(response.trim().to_string())
}

/// Query the local dooh-player for its current status.
pub async fn get_status(
    socket_path: &str,
) -> Result<PlayerStatus, Box<dyn std::error::Error + Send + Sync>> {
    let response = send_command(socket_path, &PlayerCommand::GetStatus).await?;
    let status: PlayerStatus = serde_json::from_str(&response)?;
    Ok(status)
}
