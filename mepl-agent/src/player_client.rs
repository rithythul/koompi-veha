use mepl_core::command::{PlayerCommand, PlayerStatus};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

/// Send a command to the local mepl-player daemon via its Unix socket.
/// Returns the raw JSON response string.
pub async fn send_command(
    socket_path: &str,
    command: &PlayerCommand,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let stream = UnixStream::connect(socket_path).await?;
    let (reader, mut writer) = stream.into_split();

    let cmd_json = serde_json::to_string(command)?;
    writer.write_all(format!("{cmd_json}\n").as_bytes()).await?;

    let mut reader = BufReader::new(reader);
    let mut response = String::new();
    reader.read_line(&mut response).await?;

    Ok(response.trim().to_string())
}

/// Query the local mepl-player for its current status.
pub async fn get_status(
    socket_path: &str,
) -> Result<PlayerStatus, Box<dyn std::error::Error + Send + Sync>> {
    let response = send_command(socket_path, &PlayerCommand::GetStatus).await?;
    let status: PlayerStatus = serde_json::from_str(&response)?;
    Ok(status)
}
