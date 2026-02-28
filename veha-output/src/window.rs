use veha_core::frame::VideoFrame;
use veha_core::sink::OutputSink;
use veha_core::Result;
use veha_core::error::Error;
use minifb::{Window, WindowOptions};

/// A windowed output backend using minifb.
pub struct WindowSink {
    window: Window,
    width: u32,
    height: u32,
}

impl WindowSink {
    pub fn new(title: &str, width: u32, height: u32) -> Result<Self> {
        let window = Window::new(
            title,
            width as usize,
            height as usize,
            WindowOptions {
                resize: true,
                scale_mode: minifb::ScaleMode::AspectRatioStretch,
                ..WindowOptions::default()
            },
        )
        .map_err(|e| Error::Other(format!("Failed to create window: {e}")))?;

        Ok(Self {
            window,
            width,
            height,
        })
    }

    pub fn window(&self) -> &Window {
        &self.window
    }

    pub fn window_mut(&mut self) -> &mut Window {
        &mut self.window
    }
}

impl OutputSink for WindowSink {
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()> {
        let buffer = frame.to_argb_u32();
        self.window
            .update_with_buffer(&buffer, frame.width as usize, frame.height as usize)
            .map_err(|e| Error::Other(format!("Window update failed: {e}")))?;
        Ok(())
    }

    fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_open(&self) -> bool {
        self.window.is_open()
    }
}
