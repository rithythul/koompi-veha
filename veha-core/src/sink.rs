use crate::frame::VideoFrame;
use crate::Result;

/// Backend-agnostic key event from an output sink.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SinkEvent {
    KeyPressed(SinkKey),
}

/// Backend-agnostic key codes for output sink keyboard input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SinkKey {
    Space,
    Escape,
    Left,
    Right,
    Up,
    Down,
    F,
    M,
    N,
    P,
    K,
    Comma,
    Period,
    Num0,
    Num1,
    Num2,
    Num3,
    Num4,
    Num5,
    Num6,
    Num7,
    Num8,
    Num9,
}

/// Trait for output backends that can display video frames.
pub trait OutputSink {
    /// Write a decoded video frame to the output.
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()>;

    /// The target resolution this sink expects.
    fn resolution(&self) -> (u32, u32);

    /// Whether the sink is still open/active (e.g. window not closed).
    fn is_open(&self) -> bool;

    /// Poll for keyboard/input events. Default: no events.
    fn poll_events(&mut self) -> Vec<SinkEvent> {
        vec![]
    }

    /// Toggle fullscreen mode. Default: no-op.
    fn toggle_fullscreen(&mut self) -> Result<()> {
        Ok(())
    }

    /// Whether the sink is currently in fullscreen mode.
    fn is_fullscreen(&self) -> bool {
        false
    }
}
