pub mod null;
#[cfg(feature = "window")]
pub mod window;
#[cfg(feature = "framebuffer")]
pub mod framebuffer;

pub use null::NullSink;
#[cfg(feature = "window")]
pub use window::WindowSink;
#[cfg(feature = "framebuffer")]
pub use framebuffer::FramebufferSink;
