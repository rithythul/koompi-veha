use veha_core::frame::VideoFrame;
use veha_core::sink::{OutputSink, SinkEvent, SinkKey};
use veha_core::Result;
use veha_core::error::Error;
use minifb::{Key, KeyRepeat, Window, WindowOptions};

/// A windowed output backend using minifb.
pub struct WindowSink {
    window: Window,
    width: u32,
    height: u32,
    is_fullscreen: bool,
    title: String,
}

impl WindowSink {
    /// Create a windowed (non-fullscreen) output sink.
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
            is_fullscreen: false,
            title: title.to_string(),
        })
    }

    /// Create a fullscreen (borderless, topmost) output sink.
    pub fn new_fullscreen(title: &str, width: u32, height: u32) -> Result<Self> {
        let window = Window::new(
            title,
            width as usize,
            height as usize,
            WindowOptions {
                resize: false,
                scale_mode: minifb::ScaleMode::AspectRatioStretch,
                borderless: true,
                topmost: true,
                ..WindowOptions::default()
            },
        )
        .map_err(|e| Error::Other(format!("Failed to create fullscreen window: {e}")))?;

        Ok(Self {
            window,
            width,
            height,
            is_fullscreen: true,
            title: title.to_string(),
        })
    }

    pub fn window(&self) -> &Window {
        &self.window
    }

    pub fn window_mut(&mut self) -> &mut Window {
        &mut self.window
    }

    fn recreate_window(&mut self, fullscreen: bool) -> Result<()> {
        let opts = if fullscreen {
            WindowOptions {
                resize: false,
                scale_mode: minifb::ScaleMode::AspectRatioStretch,
                borderless: true,
                topmost: true,
                ..WindowOptions::default()
            }
        } else {
            WindowOptions {
                resize: true,
                scale_mode: minifb::ScaleMode::AspectRatioStretch,
                ..WindowOptions::default()
            }
        };

        let window = Window::new(
            &self.title,
            self.width as usize,
            self.height as usize,
            opts,
        )
        .map_err(|e| Error::Other(format!("Failed to recreate window: {e}")))?;

        self.window = window;
        self.is_fullscreen = fullscreen;
        Ok(())
    }
}

fn map_key(key: Key) -> Option<SinkKey> {
    match key {
        Key::Space => Some(SinkKey::Space),
        Key::Escape => Some(SinkKey::Escape),
        Key::Left => Some(SinkKey::Left),
        Key::Right => Some(SinkKey::Right),
        Key::Up => Some(SinkKey::Up),
        Key::Down => Some(SinkKey::Down),
        Key::F => Some(SinkKey::F),
        Key::M => Some(SinkKey::M),
        Key::N => Some(SinkKey::N),
        Key::P => Some(SinkKey::P),
        Key::K => Some(SinkKey::K),
        Key::Comma => Some(SinkKey::Comma),
        Key::Period => Some(SinkKey::Period),
        Key::Key0 | Key::NumPad0 => Some(SinkKey::Num0),
        Key::Key1 | Key::NumPad1 => Some(SinkKey::Num1),
        Key::Key2 | Key::NumPad2 => Some(SinkKey::Num2),
        Key::Key3 | Key::NumPad3 => Some(SinkKey::Num3),
        Key::Key4 | Key::NumPad4 => Some(SinkKey::Num4),
        Key::Key5 | Key::NumPad5 => Some(SinkKey::Num5),
        Key::Key6 | Key::NumPad6 => Some(SinkKey::Num6),
        Key::Key7 | Key::NumPad7 => Some(SinkKey::Num7),
        Key::Key8 | Key::NumPad8 => Some(SinkKey::Num8),
        Key::Key9 | Key::NumPad9 => Some(SinkKey::Num9),
        _ => None,
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

    fn poll_events(&mut self) -> Vec<SinkEvent> {
        self.window
            .get_keys_pressed(KeyRepeat::No)
            .into_iter()
            .filter_map(|k| map_key(k).map(SinkEvent::KeyPressed))
            .collect()
    }

    fn toggle_fullscreen(&mut self) -> Result<()> {
        self.recreate_window(!self.is_fullscreen)
    }

    fn is_fullscreen(&self) -> bool {
        self.is_fullscreen
    }
}
