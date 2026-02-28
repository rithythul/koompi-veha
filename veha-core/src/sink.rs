use crate::frame::VideoFrame;
use crate::Result;

/// Trait for output backends that can display video frames.
pub trait OutputSink {
    /// Write a decoded video frame to the output.
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()>;

    /// The target resolution this sink expects.
    fn resolution(&self) -> (u32, u32);

    /// Whether the sink is still open/active (e.g. window not closed).
    fn is_open(&self) -> bool;
}
