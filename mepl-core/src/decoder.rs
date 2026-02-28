use ffmpeg_next::format::{input, Pixel};
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as ScalerContext, flag::Flags};
use ffmpeg_next::util::frame::video::Video;

use crate::error::Error;
use crate::frame::VideoFrame;
use crate::Result;

/// Decodes video frames from a media source.
pub struct Decoder {
    input_ctx: ffmpeg_next::format::context::Input,
    decoder: ffmpeg_next::decoder::Video,
    scaler: ScalerContext,
    video_stream_index: usize,
    time_base: (i32, i32),
    target_width: u32,
    target_height: u32,
}

impl Decoder {
    /// Open a media file or stream URL for decoding.
    pub fn open(source: &str, target_width: u32, target_height: u32) -> Result<Self> {
        let input_ctx = input(&source)?;

        let stream = input_ctx
            .streams()
            .best(Type::Video)
            .ok_or(Error::NoVideoStream)?;

        let video_stream_index = stream.index();
        let time_base = stream.time_base();

        let context_decoder =
            ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = context_decoder.decoder().video()?;

        let scaler = ScalerContext::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            Pixel::RGB24,
            target_width,
            target_height,
            Flags::BILINEAR,
        )?;

        Ok(Self {
            input_ctx,
            decoder,
            scaler,
            video_stream_index,
            time_base: (time_base.numerator(), time_base.denominator()),
            target_width,
            target_height,
        })
    }

    /// Open with the source's native resolution (no scaling).
    pub fn open_native(source: &str) -> Result<Self> {
        let (w, h) = {
            let input_ctx = input(&source)?;
            let stream = input_ctx
                .streams()
                .best(Type::Video)
                .ok_or(Error::NoVideoStream)?;
            let context_decoder =
                ffmpeg_next::codec::context::Context::from_parameters(stream.parameters())?;
            let dec = context_decoder.decoder().video()?;
            (dec.width(), dec.height())
        };

        Self::open(source, w, h)
    }

    pub fn source_resolution(&self) -> (u32, u32) {
        (self.decoder.width(), self.decoder.height())
    }

    pub fn target_resolution(&self) -> (u32, u32) {
        (self.target_width, self.target_height)
    }

    pub fn time_base(&self) -> (i32, i32) {
        self.time_base
    }

    pub fn frame_rate(&self) -> Option<f64> {
        let rate = self.decoder.frame_rate();
        rate.map(|r| r.numerator() as f64 / r.denominator() as f64)
    }

    fn ffmpeg_frame_to_video_frame(&self, rgb: &Video, original: &Video) -> VideoFrame {
        let width = rgb.width();
        let height = rgb.height();
        let stride = rgb.stride(0);
        let pixel_width = (width * 3) as usize;

        let mut data = Vec::with_capacity((width * height * 3) as usize);
        for y in 0..height as usize {
            let row_start = y * stride;
            let row_end = row_start + pixel_width;
            data.extend_from_slice(&rgb.data(0)[row_start..row_end]);
        }

        VideoFrame {
            data,
            width,
            height,
            pts: original.pts(),
            time_base: self.time_base,
        }
    }
}

impl Iterator for Decoder {
    type Item = Result<VideoFrame>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut decoded = Video::empty();
        let mut rgb_frame = Video::empty();

        // Try to receive a frame from pending decoded data first.
        if self.decoder.receive_frame(&mut decoded).is_ok() {
            if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                return Some(Err(e.into()));
            }
            return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
        }

        // Send packets until we get a frame.
        loop {
            let mut found_packet = false;
            for (stream, packet) in self.input_ctx.packets() {
                if stream.index() == self.video_stream_index {
                    if let Err(e) = self.decoder.send_packet(&packet) {
                        return Some(Err(e.into()));
                    }
                    found_packet = true;
                    break;
                }
            }

            if !found_packet {
                let _ = self.decoder.send_eof();
                if self.decoder.receive_frame(&mut decoded).is_ok() {
                    if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                        return Some(Err(e.into()));
                    }
                    return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
                }
                return None;
            }

            if self.decoder.receive_frame(&mut decoded).is_ok() {
                if let Err(e) = self.scaler.run(&decoded, &mut rgb_frame) {
                    return Some(Err(e.into()));
                }
                return Some(Ok(self.ffmpeg_frame_to_video_frame(&rgb_frame, &decoded)));
            }
        }
    }
}
