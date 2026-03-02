use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

/// Per-board analysis state for detecting frozen screens.
#[derive(Debug, Clone, Default)]
pub struct AnalysisState {
    pub prev_hash: Option<u64>,
}

/// Map of board_id -> analysis state.
pub type AnalysisStore = Arc<RwLock<HashMap<String, AnalysisState>>>;

/// Configurable thresholds for anomaly detection.
pub struct AnomalyThresholds {
    /// Average brightness below this means black screen (ITU-R BT.601 luminance, 0-255 scale).
    pub black_screen_brightness: f64,
    /// Brightness std deviation below this means solid color.
    pub solid_color_std_dev: f64,
}

impl Default for AnomalyThresholds {
    fn default() -> Self {
        Self {
            black_screen_brightness: 10.0,
            solid_color_std_dev: 5.0,
        }
    }
}

/// Result of analyzing a screenshot for anomalies.
#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub is_black: bool,
    pub is_frozen: bool,
    pub is_solid: bool,
    pub pixel_hash: u64,
}

/// Analyze a JPEG screenshot for anomalies (black screen, frozen screen, solid color).
///
/// This function is CPU-intensive and should be called from `spawn_blocking`.
pub fn analyze_screenshot(
    jpeg_bytes: &[u8],
    prev_hash: Option<u64>,
    thresholds: &AnomalyThresholds,
) -> Option<AnalysisResult> {
    let img = image::load_from_memory_with_format(jpeg_bytes, image::ImageFormat::Jpeg).ok()?;
    let rgb = img.to_rgb8();
    let pixels = rgb.as_raw();
    let pixel_count = (pixels.len() / 3) as f64;

    if pixel_count < 1.0 {
        return None;
    }

    // Compute average brightness using ITU-R BT.601 luminance: Y = 0.299*R + 0.587*G + 0.114*B
    let mut sum_brightness: f64 = 0.0;
    let mut sum_sq_brightness: f64 = 0.0;

    // FNV-1a hash over sampled pixels (every 4th pixel for speed)
    let mut hash: u64 = 0xcbf29ce484222325;
    let fnv_prime: u64 = 0x100000001b3;

    for chunk in pixels.chunks_exact(3) {
        let r = chunk[0] as f64;
        let g = chunk[1] as f64;
        let b = chunk[2] as f64;
        let y = 0.299 * r + 0.587 * g + 0.114 * b;
        sum_brightness += y;
        sum_sq_brightness += y * y;
    }

    // Hash over sampled pixels (every 4th pixel)
    let mut i = 0;
    for chunk in pixels.chunks_exact(3) {
        if i % 4 == 0 {
            for &byte in chunk {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(fnv_prime);
            }
        }
        i += 1;
    }

    let avg_brightness = sum_brightness / pixel_count;
    let variance = (sum_sq_brightness / pixel_count) - (avg_brightness * avg_brightness);
    let std_dev = if variance > 0.0 { variance.sqrt() } else { 0.0 };

    let is_black = avg_brightness < thresholds.black_screen_brightness;
    let is_solid = std_dev < thresholds.solid_color_std_dev;
    let is_frozen = prev_hash.is_some_and(|ph| ph == hash);

    Some(AnalysisResult {
        is_black,
        is_frozen,
        is_solid,
        pixel_hash: hash,
    })
}
