use ffmpeg_next::util::frame::video::Video;

/// Extract RGB24 pixel data from an FFmpeg frame, handling stride correctly.
pub(crate) fn extract_rgb24_data(rgb: &Video) -> Vec<u8> {
    let width = rgb.width();
    let height = rgb.height();
    let stride = rgb.stride(0);
    let pixel_width = (width * 3) as usize;

    let mut data = Vec::with_capacity((width * height * 3) as usize);
    for y in 0..height as usize {
        let row_start = y * stride;
        let row_end = row_start + pixel_width;
        data.extend_from_slice(&rgb.data(0)[row_start..row_end]);
    }
    data
}

/// A decoded video frame in RGB24 format (3 bytes per pixel).
#[derive(Clone, Debug)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pts: Option<i64>,
    pub time_base: (i32, i32),
}

impl VideoFrame {
    pub fn new(width: u32, height: u32) -> Result<Self, crate::Error> {
        let size = (width as u64)
            .checked_mul(height as u64)
            .and_then(|v| v.checked_mul(3))
            .ok_or_else(|| crate::Error::InvalidDimensions(
                format!("{}x{} overflows", width, height)
            ))?;
        if size > 128 * 1024 * 1024 {  // 128MB max frame
            return Err(crate::Error::InvalidDimensions(
                format!("{}x{} frame too large ({}MB)", width, height, size / 1024 / 1024)
            ));
        }
        Ok(Self {
            data: vec![0u8; size as usize],
            width,
            height,
            pts: None,
            time_base: (1, 30),
        })
    }

    /// Convert RGB24 frame data to packed u32 ARGB (0x00RRGGBB) for display backends.
    pub fn to_argb_u32(&self) -> Vec<u32> {
        self.data
            .chunks_exact(3)
            .map(|rgb| {
                let r = rgb[0] as u32;
                let g = rgb[1] as u32;
                let b = rgb[2] as u32;
                (r << 16) | (g << 8) | b
            })
            .collect()
    }

    /// Timestamp in seconds (if PTS is available).
    pub fn timestamp_secs(&self) -> Option<f64> {
        if self.time_base.1 == 0 {
            return None;
        }
        self.pts.map(|pts| {
            pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64
        })
    }
}
