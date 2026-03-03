use std::process::Command;

/// Show the current systemd service status for veha-edge.
pub fn run() {
    let status = Command::new("systemctl")
        .args(["status", "veha-edge", "--no-pager", "-l"])
        .status();

    match status {
        Ok(_) => {}
        Err(e) => {
            eprintln!("Failed to run systemctl: {e}");
            eprintln!("Is systemd available? Try: journalctl -u veha-edge -f");
        }
    }
}
