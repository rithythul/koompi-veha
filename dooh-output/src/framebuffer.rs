use std::fs::{File, OpenOptions};

use dooh_core::error::Error;
use dooh_core::frame::VideoFrame;
use dooh_core::sink::OutputSink;
use dooh_core::Result;

/// Reads framebuffer resolution and bits-per-pixel from sysfs.
fn read_fb_info(fb_num: u32) -> Result<(u32, u32, u32)> {
    let base = format!("/sys/class/graphics/fb{fb_num}");

    let resolution = std::fs::read_to_string(format!("{base}/virtual_size"))
        .map_err(|e| Error::Other(format!("Can't read fb resolution: {e}")))?;
    let parts: Vec<&str> = resolution.trim().split(',').collect();
    let width: u32 = parts
        .first()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| Error::Other("Can't parse fb width".into()))?;
    let height: u32 = parts
        .get(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| Error::Other("Can't parse fb height".into()))?;

    let bpp_str = std::fs::read_to_string(format!("{base}/bits_per_pixel"))
        .map_err(|e| Error::Other(format!("Can't read fb bpp: {e}")))?;
    let bpp: u32 = bpp_str
        .trim()
        .parse()
        .map_err(|_| Error::Other("Can't parse fb bpp".into()))?;

    Ok((width, height, bpp))
}

/// Output backend that writes frames directly to a Linux framebuffer device.
///
/// This is the primary output method for LED billboard displays connected via
/// HDMI to Linux SBCs (Raspberry Pi, Orange Pi, etc.). The framebuffer is
/// memory-mapped for efficient pixel writes.
pub struct FramebufferSink {
    mmap: memmap2::MmapMut,
    _file: File,
    width: u32,
    height: u32,
    bpp: u32,
    stride: usize,
    open: bool,
}

impl FramebufferSink {
    /// Open the framebuffer device `/dev/fbN` where N is `fb_num` (typically 0).
    ///
    /// The resolution and pixel format are read from sysfs automatically.
    pub fn new(fb_num: u32) -> Result<Self> {
        let (width, height, bpp) = read_fb_info(fb_num)?;
        let stride = (width * bpp / 8) as usize;
        let fb_size = stride * height as usize;

        let device_path = format!("/dev/fb{fb_num}");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&device_path)
            .map_err(|e| Error::Other(format!("Can't open {device_path}: {e}")))?;

        let mmap = unsafe {
            memmap2::MmapOptions::new()
                .len(fb_size)
                .map_mut(&file)
                .map_err(|e| Error::Other(format!("Can't mmap framebuffer: {e}")))?
        };

        tracing::info!("Framebuffer opened: {device_path} {width}x{height} {bpp}bpp");

        Ok(Self {
            mmap,
            _file: file,
            width,
            height,
            bpp,
            stride,
            open: true,
        })
    }

    /// Open the framebuffer with a specific target resolution hint.
    ///
    /// The framebuffer has a fixed resolution set by the kernel/display driver.
    /// This constructor reads the native resolution regardless of the target
    /// parameters -- the caller should scale frames to match before writing.
    pub fn with_resolution(fb_num: u32, _target_width: u32, _target_height: u32) -> Result<Self> {
        Self::new(fb_num)
    }
}

impl OutputSink for FramebufferSink {
    fn write_frame(&mut self, frame: &VideoFrame) -> Result<()> {
        if !self.open {
            return Err(Error::Other("Framebuffer closed".into()));
        }

        let src = &frame.data;
        let dst = &mut self.mmap[..];
        let src_stride = (frame.width * 3) as usize;
        let copy_height = frame.height.min(self.height) as usize;
        let copy_width = frame.width.min(self.width) as usize;

        match self.bpp {
            32 => {
                // BGRA32 -- most common for 32bpp Linux framebuffers
                for y in 0..copy_height {
                    let src_row = y * src_stride;
                    let dst_row = y * self.stride;
                    for x in 0..copy_width {
                        let si = src_row + x * 3;
                        let di = dst_row + x * 4;
                        if si + 2 < src.len() && di + 3 < dst.len() {
                            dst[di] = src[si + 2]; // B
                            dst[di + 1] = src[si + 1]; // G
                            dst[di + 2] = src[si]; // R
                            dst[di + 3] = 0xFF; // A
                        }
                    }
                }
            }
            24 => {
                // BGR24
                for y in 0..copy_height {
                    let src_row = y * src_stride;
                    let dst_row = y * self.stride;
                    for x in 0..copy_width {
                        let si = src_row + x * 3;
                        let di = dst_row + x * 3;
                        if si + 2 < src.len() && di + 2 < dst.len() {
                            dst[di] = src[si + 2]; // B
                            dst[di + 1] = src[si + 1]; // G
                            dst[di + 2] = src[si]; // R
                        }
                    }
                }
            }
            16 => {
                // RGB565
                for y in 0..copy_height {
                    let src_row = y * src_stride;
                    let dst_row = y * self.stride;
                    for x in 0..copy_width {
                        let si = src_row + x * 3;
                        let di = dst_row + x * 2;
                        if si + 2 < src.len() && di + 1 < dst.len() {
                            let r = (src[si] >> 3) as u16;
                            let g = (src[si + 1] >> 2) as u16;
                            let b = (src[si + 2] >> 3) as u16;
                            let pixel = (r << 11) | (g << 5) | b;
                            dst[di] = pixel as u8;
                            dst[di + 1] = (pixel >> 8) as u8;
                        }
                    }
                }
            }
            _ => {
                return Err(Error::Other(format!(
                    "Unsupported framebuffer bpp: {}",
                    self.bpp
                )));
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

impl Drop for FramebufferSink {
    fn drop(&mut self) {
        self.open = false;
    }
}
