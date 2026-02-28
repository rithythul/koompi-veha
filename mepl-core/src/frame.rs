/// A decoded video frame in RGB24 format (3 bytes per pixel).
#[derive(Clone)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pts: Option<i64>,
    pub time_base: (i32, i32),
}

impl VideoFrame {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            data: vec![0u8; (width * height * 3) as usize],
            width,
            height,
            pts: None,
            time_base: (1, 30),
        }
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
        self.pts.map(|pts| {
            pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64
        })
    }
}
