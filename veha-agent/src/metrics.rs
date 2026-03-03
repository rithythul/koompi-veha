use veha_core::command::SystemMetrics;

const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn collect() -> SystemMetrics {
    SystemMetrics {
        cpu_percent: read_cpu_percent(),
        memory_used_mb: read_memory_used_mb(),
        memory_total_mb: read_memory_total_mb(),
        disk_used_gb: read_disk_used_gb(),
        disk_total_gb: read_disk_total_gb(),
        temperature_celsius: read_temperature(),
        uptime_secs: read_uptime_secs(),
        agent_version: AGENT_VERSION.to_string(),
    }
}

fn read_cpu_percent() -> f32 {
    // 1-minute load average as rough CPU proxy
    std::fs::read_to_string("/proc/loadavg")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f32>().ok())
        .unwrap_or(0.0)
}

fn read_memory_used_mb() -> u32 {
    read_memory_total_mb().saturating_sub(read_meminfo_field("MemAvailable"))
}

fn read_memory_total_mb() -> u32 {
    read_meminfo_field("MemTotal")
}

fn read_meminfo_field(field: &str) -> u32 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            for line in s.lines() {
                if line.starts_with(field) {
                    return line
                        .split_whitespace()
                        .nth(1)?
                        .parse::<u64>()
                        .ok()
                        .map(|kb| (kb / 1024) as u32);
                }
            }
            None
        })
        .unwrap_or(0)
}

fn read_disk_used_gb() -> f32 {
    read_disk_total_gb() - read_disk_free_gb()
}

fn read_disk_total_gb() -> f32 {
    read_statvfs_gb(false)
}

fn read_disk_free_gb() -> f32 {
    read_statvfs_gb(true)
}

fn read_statvfs_gb(free: bool) -> f32 {
    std::process::Command::new("df")
        .args(["--output=size,avail", "-B1", "/"])
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout);
            let line = s.lines().nth(1)?;
            let mut parts = line.split_whitespace();
            let total: f64 = parts.next()?.parse().ok()?;
            let avail: f64 = parts.next()?.parse().ok()?;
            let bytes = if free { avail } else { total };
            Some((bytes / 1_073_741_824.0) as f32)
        })
        .unwrap_or(0.0)
}

fn read_temperature() -> Option<f32> {
    std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp")
        .ok()
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|millideg| millideg / 1000.0)
}

fn read_uptime_secs() -> u64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        .map(|s| s as u64)
        .unwrap_or(0)
}
