// Allow dead-code warnings on non-WASM targets: some fields and helpers are
// only used behind #[cfg(target_arch = "wasm32")] guards.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// A media item in the playlist (mirrors veha-core::MediaItem but WASM-compatible).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub source: String,
    /// Duration in seconds. For images this controls how long they display.
    /// For videos this is ignored (the video's natural duration is used).
    pub duration: Option<f64>,
    pub name: Option<String>,
}

/// A playlist (mirrors veha-core::Playlist but WASM-compatible).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub name: String,
    pub items: Vec<MediaItem>,
    pub loop_playlist: bool,
}

/// The WASM media player that controls browser media elements.
///
/// It manages playlist sequencing, timing, and state. Actual media
/// decoding and rendering is delegated to the browser's native
/// `<video>` and `<img>` elements.
#[wasm_bindgen]
pub struct vehaPlayer {
    container_id: String,
    playlist: Option<Playlist>,
    current_index: usize,
    is_playing: bool,
}

#[wasm_bindgen]
impl vehaPlayer {
    /// Create a new player targeting a container element by its DOM id.
    #[wasm_bindgen(constructor)]
    pub fn new(container_id: &str) -> Self {
        Self {
            container_id: container_id.to_string(),
            playlist: None,
            current_index: 0,
            is_playing: false,
        }
    }

    /// Load a playlist from a JSON string.
    ///
    /// The JSON should conform to the `Playlist` schema:
    /// ```json
    /// {
    ///   "name": "My Playlist",
    ///   "items": [
    ///     { "source": "video.mp4", "duration": null, "name": "A Video" },
    ///     { "source": "image.png", "duration": 5.0, "name": "A Slide" }
    ///   ],
    ///   "loop_playlist": true
    /// }
    /// ```
    pub fn load_playlist(&mut self, json: &str) -> Result<(), JsValue> {
        let playlist: Playlist = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("Invalid playlist JSON: {e}")))?;

        log(&format!(
            "Loaded playlist: {} ({} items)",
            playlist.name,
            playlist.items.len()
        ));
        self.playlist = Some(playlist);
        self.current_index = 0;
        Ok(())
    }

    /// Start playback from the current item.
    pub fn play(&mut self) -> Result<(), JsValue> {
        self.is_playing = true;
        self.show_current_item()?;
        Ok(())
    }

    /// Pause playback.
    pub fn pause(&mut self) -> Result<(), JsValue> {
        self.is_playing = false;
        self.pause_active_video()?;
        Ok(())
    }

    /// Skip to the next item in the playlist.
    pub fn next(&mut self) -> Result<(), JsValue> {
        if let Some(ref playlist) = self.playlist {
            self.current_index += 1;
            if self.current_index >= playlist.items.len() {
                if playlist.loop_playlist {
                    self.current_index = 0;
                } else {
                    self.is_playing = false;
                    return Ok(());
                }
            }
            if self.is_playing {
                self.show_current_item()?;
            }
        }
        Ok(())
    }

    /// Skip to the previous item in the playlist.
    pub fn previous(&mut self) -> Result<(), JsValue> {
        if let Some(ref playlist) = self.playlist {
            if self.current_index == 0 {
                self.current_index = playlist.items.len().saturating_sub(1);
            } else {
                self.current_index -= 1;
            }
            if self.is_playing {
                self.show_current_item()?;
            }
        }
        Ok(())
    }

    /// Get current player state as a JSON string.
    pub fn get_status(&self) -> String {
        let status = serde_json::json!({
            "is_playing": self.is_playing,
            "current_index": self.current_index,
            "current_item": self.playlist.as_ref()
                .and_then(|p| p.items.get(self.current_index))
                .map(|i| &i.source),
            "total_items": self.playlist.as_ref().map(|p| p.items.len()).unwrap_or(0),
            "playlist_name": self.playlist.as_ref().map(|p| &p.name),
        });
        serde_json::to_string(&status).unwrap_or_default()
    }

    /// Get the index of the currently active item.
    pub fn current_index(&self) -> usize {
        self.current_index
    }

    /// Check whether the player is currently playing.
    pub fn is_playing(&self) -> bool {
        self.is_playing
    }
}

// ---------------------------------------------------------------------------
// Private helpers — all browser interaction is behind cfg(target_arch = "wasm32")
// ---------------------------------------------------------------------------

impl vehaPlayer {
    #[cfg(target_arch = "wasm32")]
    fn show_current_item(&self) -> Result<(), JsValue> {
        use wasm_bindgen::JsCast;
        use web_sys::{HtmlImageElement, HtmlVideoElement};

        let playlist = self
            .playlist
            .as_ref()
            .ok_or_else(|| JsValue::from_str("No playlist loaded"))?;

        let item = playlist
            .items
            .get(self.current_index)
            .ok_or_else(|| JsValue::from_str("Invalid playlist index"))?;

        let window = web_sys::window().unwrap();
        let document = window.document().unwrap();
        let container = document
            .get_element_by_id(&self.container_id)
            .ok_or_else(|| {
                JsValue::from_str(&format!("Container '{}' not found", self.container_id))
            })?;

        // Clear previous content
        container.set_inner_html("");

        let source = &item.source;
        let is_image = is_image_source(source);

        if is_image {
            let img: HtmlImageElement = document.create_element("img")?.dyn_into()?;
            img.set_src(source);
            img.style().set_property("width", "100%")?;
            img.style().set_property("height", "100%")?;
            img.style().set_property("object-fit", "contain")?;
            container.append_child(&img)?;

            // Auto-advance after duration (for images only)
            if let Some(duration) = item.duration {
                let duration_ms = (duration * 1000.0) as i32;
                let document_clone = document.clone();
                let closure = Closure::once(move || {
                    dispatch_advance_event(&document_clone);
                });
                window.set_timeout_with_callback_and_timeout_and_arguments_0(
                    closure.as_ref().unchecked_ref(),
                    duration_ms,
                )?;
                closure.forget();
            }
        } else {
            // Treat as video
            let video: HtmlVideoElement = document.create_element("video")?.dyn_into()?;
            video.set_src(source);
            video.set_autoplay(true);
            video.style().set_property("width", "100%")?;
            video.style().set_property("height", "100%")?;
            video.style().set_property("object-fit", "contain")?;

            // Advance when the video ends
            let document_clone = document.clone();
            let on_ended = Closure::once(move || {
                dispatch_advance_event(&document_clone);
            });
            video.set_onended(Some(on_ended.as_ref().unchecked_ref()));
            on_ended.forget();

            container.append_child(&video)?;
        }

        log(&format!(
            "Playing: {} (item {}/{})",
            item.name.as_deref().unwrap_or(source),
            self.current_index + 1,
            playlist.items.len()
        ));

        Ok(())
    }

    /// Stub for non-WASM compilation.
    #[cfg(not(target_arch = "wasm32"))]
    fn show_current_item(&self) -> Result<(), JsValue> {
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    fn pause_active_video(&self) -> Result<(), JsValue> {
        use wasm_bindgen::JsCast;
        use web_sys::HtmlVideoElement;

        let document = web_sys::window().unwrap().document().unwrap();
        if let Ok(Some(video)) = document.query_selector("video") {
            let video: HtmlVideoElement = video.dyn_into()?;
            video.pause()?;
        }
        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn pause_active_video(&self) -> Result<(), JsValue> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/// Check whether a source URL looks like an image based on its extension.
fn is_image_source(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".bmp")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
        || lower.ends_with(".svg")
}

/// Dispatch a custom `veha-advance` event on the document so that JS glue
/// code can call `player.next()`.
#[cfg(target_arch = "wasm32")]
fn dispatch_advance_event(document: &web_sys::Document) {
    use web_sys::{CustomEvent, CustomEventInit, EventTarget};

    let init = CustomEventInit::new();
    init.set_detail(&JsValue::from_str("next"));
    if let Ok(event) = CustomEvent::new_with_event_init_dict("veha-advance", &init) {
        let target: &EventTarget = document.as_ref();
        let _ = target.dispatch_event(&event);
    }
}

/// Log a message to the browser console (WASM) or stdout (native).
fn log(msg: &str) {
    #[cfg(target_arch = "wasm32")]
    web_sys::console::log_1(&msg.into());

    #[cfg(not(target_arch = "wasm32"))]
    println!("{msg}");
}
