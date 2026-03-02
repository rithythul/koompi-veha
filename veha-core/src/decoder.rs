use ffmpeg_next::format::{input, Pixel};
use ffmpeg_next::media::Type;
use ffmpeg_next::software::scaling::{context::Context as ScalerContext, flag::Flags};
use ffmpeg_next::util::frame::video::Video;

use crate::error::Error;
use crate::frame::{self, VideoFrame};
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
    eof_sent: bool,
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
            eof_sent: false,
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
        self.decoder.frame_rate().and_then(|r| {
            if r.denominator() == 0 {
                None
            } else {
                Some(r.numerator() as f64 / r.denominator() as f64)
            }
        })
    }

    fn ffmpeg_frame_to_video_frame(&self, rgb: &Video, original: &Video) -> VideoFrame {
        VideoFrame {
            data: frame::extract_rgb24_data(rgb),
            width: rgb.width(),
            height: rgb.height(),
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
                if !self.eof_sent {
                    let _ = self.decoder.send_eof();
                    self.eof_sent = true;
                }
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

// ---------------------------------------------------------------------------
// AVDecoder — full audio+video decoder
// ---------------------------------------------------------------------------

/// A decoded audio frame in interleaved f32 PCM format.
#[derive(Clone, Debug)]
pub struct AudioFrame {
    /// Interleaved f32 PCM samples.
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub pts: Option<i64>,
    pub time_base: (i32, i32),
}

impl AudioFrame {
    /// Timestamp of this audio frame in seconds.
    pub fn timestamp_secs(&self) -> Option<f64> {
        if self.time_base.1 == 0 {
            return None;
        }
        self.pts
            .map(|pts| pts as f64 * self.time_base.0 as f64 / self.time_base.1 as f64)
    }
}

/// Either a video or audio frame from the AVDecoder.
pub enum DecodedFrame {
    Video(VideoFrame),
    Audio(AudioFrame),
}

/// Decodes both video and audio streams from a media source.
pub struct AVDecoder {
    input_ctx: ffmpeg_next::format::context::Input,
    video_decoder: ffmpeg_next::decoder::Video,
    audio_decoder: Option<ffmpeg_next::decoder::Audio>,
    video_scaler: ScalerContext,
    audio_resampler: Option<ffmpeg_next::software::resampling::Context>,
    video_stream_index: usize,
    audio_stream_index: Option<usize>,
    video_time_base: (i32, i32),
    audio_time_base: (i32, i32),
    audio_sample_rate: u32,
    audio_channels: u16,
    #[allow(dead_code)]
    target_width: u32,
    #[allow(dead_code)]
    target_height: u32,
    duration_ts: Option<i64>,
    eof_sent_video: bool,
    eof_sent_audio: bool,
}

impl AVDecoder {
    /// Open a media source for both video and audio decoding.
    pub fn open(source: &str, target_width: u32, target_height: u32) -> Result<Self> {
        let input_ctx = input(&source)?;

        // Video stream
        let video_stream = input_ctx
            .streams()
            .best(Type::Video)
            .ok_or(Error::NoVideoStream)?;
        let video_stream_index = video_stream.index();
        let video_tb = video_stream.time_base();

        let video_ctx =
            ffmpeg_next::codec::context::Context::from_parameters(video_stream.parameters())?;
        let video_decoder = video_ctx.decoder().video()?;

        let video_scaler = ScalerContext::get(
            video_decoder.format(),
            video_decoder.width(),
            video_decoder.height(),
            Pixel::RGB24,
            target_width,
            target_height,
            Flags::BILINEAR,
        )?;

        // Audio stream (optional)
        let mut audio_decoder = None;
        let mut audio_resampler = None;
        let mut audio_stream_index = None;
        let mut audio_time_base = (0i32, 1i32);
        let mut audio_sample_rate = 44100u32;
        let mut audio_channels = 2u16;

        if let Some(audio_stream) = input_ctx.streams().best(Type::Audio) {
            audio_stream_index = Some(audio_stream.index());
            let atb = audio_stream.time_base();
            audio_time_base = (atb.numerator(), atb.denominator());

            let audio_ctx =
                ffmpeg_next::codec::context::Context::from_parameters(audio_stream.parameters())?;
            let adec = audio_ctx.decoder().audio()?;

            audio_sample_rate = adec.rate();
            audio_channels = adec.channels() as u16;

            // Resample to f32 planar → we'll interleave manually
            // Actually, let's resample to packed (interleaved) F32
            let resampler = ffmpeg_next::software::resampling::Context::get(
                adec.format(),
                adec.channel_layout(),
                adec.rate(),
                ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
                adec.channel_layout(),
                adec.rate(),
            )
            .map_err(|e| Error::Other(format!("Failed to create audio resampler: {e}")))?;

            audio_decoder = Some(adec);
            audio_resampler = Some(resampler);
        }

        // Duration from container
        let duration_ts = {
            let dur = input_ctx.duration();
            if dur > 0 { Some(dur) } else { None }
        };

        Ok(Self {
            input_ctx,
            video_decoder,
            audio_decoder,
            video_scaler,
            audio_resampler,
            video_stream_index,
            audio_stream_index,
            video_time_base: (video_tb.numerator(), video_tb.denominator()),
            audio_time_base,
            audio_sample_rate,
            audio_channels,
            target_width,
            target_height,
            duration_ts,
            eof_sent_video: false,
            eof_sent_audio: false,
        })
    }

    /// Total media duration in seconds, if known.
    pub fn duration_secs(&self) -> Option<f64> {
        // FFmpeg stores duration in AV_TIME_BASE units (microseconds)
        self.duration_ts
            .map(|d| d as f64 / f64::from(ffmpeg_next::ffi::AV_TIME_BASE))
    }

    /// Whether this media has an audio stream.
    pub fn has_audio(&self) -> bool {
        self.audio_decoder.is_some()
    }

    /// Video frame rate.
    pub fn frame_rate(&self) -> Option<f64> {
        self.video_decoder.frame_rate().and_then(|r| {
            if r.denominator() == 0 {
                None
            } else {
                Some(r.numerator() as f64 / r.denominator() as f64)
            }
        })
    }

    /// Seek to a position in seconds. Flushes both decoders.
    pub fn seek(&mut self, position_secs: f64) -> Result<()> {
        let timestamp = (position_secs * f64::from(ffmpeg_next::ffi::AV_TIME_BASE)) as i64;

        self.input_ctx
            .seek(timestamp, ..timestamp)
            .map_err(|e| Error::Other(format!("Seek failed: {e}")))?;

        // Flush decoders
        self.video_decoder.flush();
        if let Some(ref mut adec) = self.audio_decoder {
            adec.flush();
        }
        self.eof_sent_video = false;
        self.eof_sent_audio = false;

        Ok(())
    }

    /// Try to drain a decoded video frame from the video decoder buffer.
    fn drain_video_frame(&mut self) -> Option<Result<VideoFrame>> {
        let mut decoded = Video::empty();
        if self.video_decoder.receive_frame(&mut decoded).is_ok() {
            let mut rgb_frame = Video::empty();
            if let Err(e) = self.video_scaler.run(&decoded, &mut rgb_frame) {
                return Some(Err(e.into()));
            }
            let vf = VideoFrame {
                data: frame::extract_rgb24_data(&rgb_frame),
                width: rgb_frame.width(),
                height: rgb_frame.height(),
                pts: decoded.pts(),
                time_base: self.video_time_base,
            };
            return Some(Ok(vf));
        }
        None
    }

    /// Try to drain a decoded audio frame from the audio decoder buffer.
    fn drain_audio_frame(&mut self) -> Option<Result<AudioFrame>> {
        let adec = self.audio_decoder.as_mut()?;
        let resampler = self.audio_resampler.as_mut()?;

        let mut decoded = ffmpeg_next::util::frame::audio::Audio::empty();
        if adec.receive_frame(&mut decoded).is_ok() {
            let mut resampled = ffmpeg_next::util::frame::audio::Audio::empty();
            match resampler.run(&decoded, &mut resampled) {
                Ok(_) => {}
                Err(e) => return Some(Err(Error::Other(format!("Audio resample error: {e}")))),
            }

            // Extract interleaved f32 samples from plane 0
            let data = resampled.data(0);
            let sample_count = resampled.samples() * self.audio_channels as usize;
            let byte_len = sample_count * 4; // f32 = 4 bytes
            let actual_len = byte_len.min(data.len());
            let samples: Vec<f32> = data[..actual_len]
                .chunks_exact(4)
                .map(|chunk| f32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect();

            let af = AudioFrame {
                samples,
                sample_rate: self.audio_sample_rate,
                channels: self.audio_channels,
                pts: decoded.pts(),
                time_base: self.audio_time_base,
            };
            return Some(Ok(af));
        }
        None
    }
}

impl Iterator for AVDecoder {
    type Item = Result<DecodedFrame>;

    fn next(&mut self) -> Option<Self::Item> {
        // First try to drain any buffered frames
        if let Some(vf) = self.drain_video_frame() {
            return Some(vf.map(DecodedFrame::Video));
        }
        if let Some(af) = self.drain_audio_frame() {
            return Some(af.map(DecodedFrame::Audio));
        }

        // Read packets and feed to decoders
        loop {
            let mut found_packet = false;

            for (stream, packet) in self.input_ctx.packets() {
                let idx = stream.index();

                if idx == self.video_stream_index {
                    if let Err(e) = self.video_decoder.send_packet(&packet) {
                        return Some(Err(e.into()));
                    }
                    found_packet = true;

                    // Try to get a video frame
                    if let Some(vf) = self.drain_video_frame() {
                        return Some(vf.map(DecodedFrame::Video));
                    }
                    // Also check for audio frames that may have been buffered
                    if let Some(af) = self.drain_audio_frame() {
                        return Some(af.map(DecodedFrame::Audio));
                    }
                    break;
                } else if Some(idx) == self.audio_stream_index {
                    if let Some(ref mut adec) = self.audio_decoder {
                        if let Err(e) = adec.send_packet(&packet) {
                            return Some(Err(e.into()));
                        }
                    }
                    found_packet = true;

                    // Try to get an audio frame
                    if let Some(af) = self.drain_audio_frame() {
                        return Some(af.map(DecodedFrame::Audio));
                    }
                    // Also check for video frames
                    if let Some(vf) = self.drain_video_frame() {
                        return Some(vf.map(DecodedFrame::Video));
                    }
                    break;
                }
                // Skip other stream types (subtitles, etc.)
            }

            if !found_packet {
                // EOF — flush decoders
                if !self.eof_sent_video {
                    let _ = self.video_decoder.send_eof();
                    self.eof_sent_video = true;
                }
                if !self.eof_sent_audio {
                    if let Some(ref mut adec) = self.audio_decoder {
                        let _ = adec.send_eof();
                    }
                    self.eof_sent_audio = true;
                }

                // Drain remaining frames
                if let Some(vf) = self.drain_video_frame() {
                    return Some(vf.map(DecodedFrame::Video));
                }
                if let Some(af) = self.drain_audio_frame() {
                    return Some(af.map(DecodedFrame::Audio));
                }
                return None;
            }
        }
    }
}
