use std::time::Duration;

use dooh_core::{MediaItem, Playlist};

#[test]
fn test_playlist_creation() {
    let mut playlist = Playlist::new("test");
    assert!(playlist.is_empty());
    assert_eq!(playlist.len(), 0);

    playlist.add(MediaItem {
        source: "video.mp4".to_string(),
        duration: None,
        name: Some("Video".to_string()),
    });

    assert!(!playlist.is_empty());
    assert_eq!(playlist.len(), 1);
}

#[test]
fn test_playlist_json_roundtrip() {
    let mut playlist = Playlist::new("test-playlist");
    playlist.loop_playlist = true;
    playlist.add(MediaItem {
        source: "video.mp4".to_string(),
        duration: Some(Duration::from_secs(10)),
        name: Some("Test Video".to_string()),
    });
    playlist.add(MediaItem {
        source: "image.png".to_string(),
        duration: Some(Duration::from_secs(5)),
        name: None,
    });

    let path = "/tmp/dooh-test-playlist.json";
    playlist.to_json_file(path).unwrap();

    let loaded = Playlist::from_json_file(path).unwrap();
    assert_eq!(loaded.name, "test-playlist");
    assert_eq!(loaded.items.len(), 2);
    assert!(loaded.loop_playlist);
    assert_eq!(loaded.items[0].source, "video.mp4");
    assert_eq!(loaded.items[1].source, "image.png");

    std::fs::remove_file(path).ok();
}
