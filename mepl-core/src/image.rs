use std::path::Path;

use ffmpeg_next::format::{input, Pixel};
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as ScalerContext, flag::Flags};
use ffmpeg_next::util::frame::video::Video;

use crate::error::Error;
use crate::frame::{self, VideoFrame};
use crate::Result;

/// Decode a single image file into a VideoFrame.
pub fn decode_image(path: &str, target_width: u32, target_height: u32) -> Result<VideoFrame> {
    let mut input_ctx = input(&path)?;

    let stream = input_ctx
        .streams()
        .best(Type::Video)
        .ok_or(Error::NoVideoStream)?;

    let stream_index = stream.index();
    let context_decoder =
        ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = context_decoder.decoder().video()?;

    let mut scaler = ScalerContext::get(
        decoder.format(),
        decoder.width(),
        decoder.height(),
        Pixel::RGB24,
        target_width,
        target_height,
        Flags::BILINEAR,
    )?;

    for (stream, packet) in input_ctx.packets() {
        if stream.index() == stream_index {
            decoder.send_packet(&packet)?;
            let mut decoded = Video::empty();
            if decoder.receive_frame(&mut decoded).is_ok() {
                let mut rgb_frame = Video::empty();
                scaler.run(&decoded, &mut rgb_frame)?;

                return Ok(VideoFrame {
                    data: frame::extract_rgb24_data(&rgb_frame),
                    width: rgb_frame.width(),
                    height: rgb_frame.height(),
                    pts: None,
                    time_base: (1, 1),
                });
            }
        }
    }

    Err(Error::Other("Failed to decode image".into()))
}

/// Check if a file path looks like an image (by extension).
pub fn is_image_path(path: &str) -> bool {
    let p = Path::new(path);
    matches!(
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "bmp" | "tiff" | "tif" | "webp")
    )
}
