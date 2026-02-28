use mepl_core::frame::VideoFrame;
use mepl_core::sink::OutputSink;
use mepl_core::Result;

/// A null output sink that discards frames. Useful for testing and benchmarking.
pub struct NullSink {
    width: u32,
    height: u32,
    frame_count: u64,
    open: bool,
    max_frames: Option<u64>,
}

impl NullSink {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            frame_count: 0,
            open: true,
            max_frames: None,
        }
    }

    pub fn with_max_frames(width: u32, height: u32, max: u64) -> Self {
        Self {
            width,
            height,
            frame_count: 0,
            open: true,
            max_frames: Some(max),
        }
    }

    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }
}

impl OutputSink for NullSink {
    fn write_frame(&mut self, _frame: &VideoFrame) -> Result<()> {
        self.frame_count += 1;
        if let Some(max) = self.max_frames {
            if self.frame_count >= max {
                self.open = false;
            }
        }
        Ok(())
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_open(&self) -> bool {
        self.open
    }
}
