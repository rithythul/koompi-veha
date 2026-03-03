use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;

use tracing::{error, info};

/// GitHub repository for release downloads (owner/repo).
const REPO: &str = "rithythul/koompi-veha";

/// Installed binary path.
const INSTALL_PATH: &str = "/opt/veha/veha-edge";

/// Returns the architecture suffix used in release artifact names.
fn arch_suffix() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64-linux"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-linux"
    } else {
        panic!("unsupported architecture — self-update not supported on this platform")
    }
}

/// Download and atomically replace the installed binary with the latest
/// release from GitHub, then restart the systemd service.
pub async fn run() {
    let suffix = arch_suffix();
    let url = format!(
        "https://github.com/{REPO}/releases/latest/download/veha-edge-{suffix}"
    );

    println!("Fetching latest veha-edge ({suffix}) from GitHub Releases...");
    info!("Downloading {url}");

    let response = reqwest::get(&url).await.unwrap_or_else(|e| {
        error!("Download failed: {e}");
        std::process::exit(1);
    });

    if !response.status().is_success() {
        error!("Download failed: HTTP {}", response.status());
        std::process::exit(1);
    }

    let bytes = response.bytes().await.unwrap_or_else(|e| {
        error!("Failed to read response body: {e}");
        std::process::exit(1);
    });

    // Write to a temp file, make executable, then atomically replace
    let tmp_path = format!("{INSTALL_PATH}.tmp");
    fs::write(&tmp_path, &bytes).unwrap_or_else(|e| {
        error!("Failed to write to {tmp_path}: {e}");
        std::process::exit(1);
    });
    fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o755))
        .expect("failed to set permissions on downloaded binary");
    fs::rename(&tmp_path, INSTALL_PATH).unwrap_or_else(|e| {
        error!("Failed to replace binary at {INSTALL_PATH}: {e}");
        // Clean up temp file on failure
        fs::remove_file(&tmp_path).ok();
        std::process::exit(1);
    });

    info!("Binary updated at {INSTALL_PATH}");
    println!("Update complete. Restarting service...");

    let status = Command::new("systemctl")
        .args(["restart", "veha-edge"])
        .status();

    match status {
        Ok(s) if s.success() => println!("veha-edge restarted successfully."),
        Ok(s) => {
            error!("systemctl restart exited with status {s}");
            println!("Warning: service restart failed. Run: systemctl restart veha-edge");
        }
        Err(e) => {
            error!("Failed to run systemctl: {e}");
            println!("Warning: could not restart service. Run: systemctl restart veha-edge");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arch_suffix_is_known() {
        // Verify we get a non-empty suffix on the current build architecture.
        // This will panic on unsupported arches (which is the correct behavior).
        let suffix = arch_suffix();
        assert!(suffix.ends_with("-linux"));
        assert!(!suffix.is_empty());
    }

    #[test]
    fn test_download_url_format() {
        let suffix = arch_suffix();
        let url = format!(
            "https://github.com/{REPO}/releases/latest/download/veha-edge-{suffix}"
        );
        assert!(url.starts_with("https://github.com/"));
        assert!(url.contains("releases/latest/download/veha-edge-"));
        assert!(url.ends_with(suffix));
    }
}
