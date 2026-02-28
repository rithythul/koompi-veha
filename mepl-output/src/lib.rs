pub mod null;
#[cfg(feature = "window")]
pub mod window;

pub use null::NullSink;
#[cfg(feature = "window")]
pub use window::WindowSink;
