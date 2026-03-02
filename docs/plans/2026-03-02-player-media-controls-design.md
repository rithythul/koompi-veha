# veha-player Enhanced Media Controls

**Date**: 2026-03-02
**Status**: Approved

## Summary

Enhance veha-player with fullscreen mode, audio playback, YouTube-style keyboard controls, seek, speed control, and volume management.

## 1. Fullscreen Window

- Borderless + topmost + screen-resolution window = pseudo-fullscreen (minifb has no native fullscreen API)
- `fullscreen = true` (default) in `veha-player.toml`
- `F` key toggles between fullscreen and windowed mode
- `Esc` exits fullscreen back to windowed
- Window is reconstructed on toggle (minifb limitation)
- Screen resolution detected from config width/height values

## 2. Audio Pipeline

- Extend `Decoder` to decode audio stream alongside video, producing `AudioFrame` chunks (interleaved f32 PCM)
- New `veha-core/src/audio.rs` — `AudioPlayer` using `rodio` with `OutputStream` + `Sink`
- Ring buffer (crossbeam or `ringbuf`) fed by decoder, consumed by rodio source
- Volume control (0.0-1.0), mute toggle, speed control via rodio
- A/V sync: audio is clock master, video frame display gated by comparing video PTS to elapsed audio time
- Dependencies: `rodio`, `ringbuf`

## 3. Keyboard Controls

| Key | Action |
|-----|--------|
| Space / K | Play/Pause toggle |
| Left arrow | Seek -5s |
| Right arrow | Seek +5s |
| Up arrow | Volume +5% |
| Down arrow | Volume -5% |
| M | Mute toggle |
| F | Fullscreen toggle |
| Esc | Exit fullscreen / Stop |
| N | Next playlist item |
| P | Previous playlist item |
| > (Period) | Speed +0.25x |
| < (Comma) | Speed -0.25x |
| 0-9 | Seek to 0%-90% of duration |

Handled in window backend's frame update loop via `get_keys_pressed()`.

## 4. New PlayerCommands

```rust
Seek(f64)            // absolute position in seconds
SeekRelative(f64)    // ±N seconds from current position
SetVolume(f32)       // 0.0 to 1.0
Mute                 // toggle mute
SetSpeed(f32)        // 0.25 to 4.0
ToggleFullscreen     // toggle fullscreen mode
```

## 5. Enhanced PlayerStatus

```rust
position_secs: f64
duration_secs: Option<f64>
volume: f32
is_muted: bool
playback_speed: f32
is_fullscreen: bool
```

## 6. Architecture

```
Player Thread (blocking):
  Decoder -> VideoFrame -> WindowSink
     |                        |
     +-> AudioFrame -> AudioPlayer (rodio)

  A/V Sync: video waits for audio clock
  Seek: FFmpeg seek + flush decoder + flush audio
  Speed: rodio speed() + frame timing adjust

Keyboard Handler (in write_frame loop):
  minifb get_keys_pressed() -> command channel
```

## 7. Out of Scope

OSD overlay, subtitles, multiple audio tracks, equalizer, HDR.
