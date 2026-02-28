use std::thread;
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::decoder::Decoder;
use crate::image;
use crate::playlist::{MediaItem, Playlist};
use crate::sink::OutputSink;
use crate::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerState {
    Stopped,
    Playing,
    Paused,
}

/// Plays media items to an OutputSink.
pub struct Player {
    state: PlayerState,
}

impl Player {
    pub fn new() -> Self {
        Self {
            state: PlayerState::Stopped,
        }
    }

    pub fn state(&self) -> PlayerState {
        self.state
    }

    pub fn play_item(&mut self, item: &MediaItem, sink: &mut dyn OutputSink) -> Result<()> {
        let (target_w, target_h) = sink.resolution();
        info!("Playing: {}", item.source);

        if image::is_image_path(&item.source) {
            self.play_image(item, sink, target_w, target_h)?;
        } else {
            self.play_video(item, sink, target_w, target_h)?;
        }

        Ok(())
    }

    pub fn play_playlist(&mut self, playlist: &Playlist, sink: &mut dyn OutputSink) -> Result<()> {
        self.state = PlayerState::Playing;

        loop {
            for (i, item) in playlist.items.iter().enumerate() {
                if !sink.is_open() || self.state == PlayerState::Stopped {
                    self.state = PlayerState::Stopped;
                    return Ok(());
                }

                info!(
                    "Playlist item {}/{}: {}",
                    i + 1,
                    playlist.len(),
                    item.source
                );
                if let Err(e) = self.play_item(item, sink) {
                    warn!("Error playing {}: {e}. Skipping.", item.source);
                }
            }

            if !playlist.loop_playlist {
                break;
            }
            info!("Looping playlist: {}", playlist.name);
        }

        self.state = PlayerState::Stopped;
        Ok(())
    }

    fn play_video(
        &mut self,
        item: &MediaItem,
        sink: &mut dyn OutputSink,
        target_w: u32,
        target_h: u32,
    ) -> Result<()> {
        let decoder = Decoder::open(&item.source, target_w, target_h)?;
        let fps = decoder.frame_rate().unwrap_or(30.0);
        let frame_duration = Duration::from_secs_f64(1.0 / fps);
        let playback_start = Instant::now();

        self.state = PlayerState::Playing;

        for frame_result in decoder {
            if !sink.is_open() || self.state == PlayerState::Stopped {
                break;
            }

            if let Some(max_dur) = item.duration {
                if playback_start.elapsed() >= max_dur {
                    break;
                }
            }

            let frame = frame_result?;
            let frame_start = Instant::now();
            sink.write_frame(&frame)?;

            let elapsed = frame_start.elapsed();
            if elapsed < frame_duration {
                thread::sleep(frame_duration - elapsed);
            }
        }

        Ok(())
    }

    fn play_image(
        &mut self,
        item: &MediaItem,
        sink: &mut dyn OutputSink,
        target_w: u32,
        target_h: u32,
    ) -> Result<()> {
        let frame = image::decode_image(&item.source, target_w, target_h)?;
        let display_duration = item.duration.unwrap_or(Duration::from_secs(5));
        let start = Instant::now();

        self.state = PlayerState::Playing;

        while sink.is_open() && start.elapsed() < display_duration {
            sink.write_frame(&frame)?;
            thread::sleep(Duration::from_millis(16));
        }

        Ok(())
    }
}
