use rodio::{OutputStream, OutputStreamHandle, Sink};
use tracing::warn;

use crate::Result;
use crate::error::Error;

/// Audio output player wrapping rodio.
pub struct AudioPlayer {
    sink: Sink,
    _stream: OutputStream,
    _stream_handle: OutputStreamHandle,
    volume: f32,
    is_muted: bool,
    speed: f32,
}

impl AudioPlayer {
    /// Open the default audio output device.
    pub fn new() -> Result<Self> {
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| Error::Other(format!("Failed to open audio device: {e}")))?;
        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| Error::Other(format!("Failed to create audio sink: {e}")))?;

        Ok(Self {
            sink,
            _stream: stream,
            _stream_handle: stream_handle,
            volume: 1.0,
            is_muted: false,
            speed: 1.0,
        })
    }

    /// Push interleaved f32 PCM samples to the audio queue.
    pub fn push_samples(&self, samples: &[f32], sample_rate: u32, channels: u16) {
        if samples.is_empty() {
            return;
        }
        let source = rodio::buffer::SamplesBuffer::new(channels, sample_rate, samples.to_vec());
        self.sink.append(source);
    }

    /// Set volume (0.0 to 1.0). Applied immediately.
    pub fn set_volume(&mut self, v: f32) {
        self.volume = v.clamp(0.0, 1.0);
        if !self.is_muted {
            self.sink.set_volume(self.volume);
        }
    }

    /// Get current volume setting.
    pub fn volume(&self) -> f32 {
        self.volume
    }

    /// Toggle mute on/off.
    pub fn toggle_mute(&mut self) {
        self.is_muted = !self.is_muted;
        if self.is_muted {
            self.sink.set_volume(0.0);
        } else {
            self.sink.set_volume(self.volume);
        }
    }

    /// Whether audio is currently muted.
    pub fn is_muted(&self) -> bool {
        self.is_muted
    }

    /// Set playback speed multiplier.
    pub fn set_speed(&mut self, s: f32) {
        self.speed = s.clamp(0.25, 4.0);
        self.sink.set_speed(self.speed);
    }

    /// Current playback speed.
    pub fn speed(&self) -> f32 {
        self.speed
    }

    /// Pause audio playback.
    pub fn pause(&self) {
        self.sink.pause();
    }

    /// Resume audio playback.
    pub fn resume(&self) {
        self.sink.play();
    }

    /// Stop and clear all queued audio.
    pub fn stop(&self) {
        self.sink.stop();
    }

    /// Clear queued audio (for seek). Recreates the sink.
    pub fn flush(&mut self) {
        // rodio doesn't have a flush method — clearing means stopping and
        // creating a new sink. But we don't have the stream_handle stored
        // in a way we can recreate. Instead, we skip all queued audio.
        self.sink.stop();
        // The sink is now empty and stopped. We need to create a new one,
        // but we can't without the stream handle. Instead, use clear().
        // Actually, after stop() the sink is unusable. Let's just skip
        // remaining audio by sleeping 0 and clearing.

        // Rodio Sink after stop() will not accept new audio. We need to
        // recreate. Since _stream_handle is stored, we can do this.
        match Sink::try_new(&self._stream_handle) {
            Ok(new_sink) => {
                new_sink.set_volume(if self.is_muted { 0.0 } else { self.volume });
                new_sink.set_speed(self.speed);
                self.sink = new_sink;
            }
            Err(e) => {
                warn!("Failed to recreate audio sink after flush: {e}");
            }
        }
    }

    /// Number of samples currently queued in the sink.
    pub fn queued_samples(&self) -> usize {
        self.sink.len()
    }

    /// Whether the sink is empty (no audio queued).
    pub fn is_empty(&self) -> bool {
        self.sink.empty()
    }
}
