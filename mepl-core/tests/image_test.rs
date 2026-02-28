use mepl_core::image::{decode_image, is_image_path};

const TEST_IMAGE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/test.png");

#[test]
fn test_decode_image() {
    mepl_core::init().unwrap();

    let frame = decode_image(TEST_IMAGE, 320, 240).unwrap();
    assert_eq!(frame.width, 320);
    assert_eq!(frame.height, 240);
    assert_eq!(frame.data.len(), (320 * 240 * 3) as usize);
}

#[test]
fn test_decode_image_with_scaling() {
    mepl_core::init().unwrap();

    let frame = decode_image(TEST_IMAGE, 160, 120).unwrap();
    assert_eq!(frame.width, 160);
    assert_eq!(frame.height, 120);
}

#[test]
fn test_is_image_path() {
    assert!(is_image_path("photo.png"));
    assert!(is_image_path("photo.jpg"));
    assert!(is_image_path("photo.jpeg"));
    assert!(is_image_path("photo.bmp"));
    assert!(is_image_path("photo.webp"));
    assert!(is_image_path("PHOTO.PNG")); // case insensitive
    assert!(!is_image_path("video.mp4"));
    assert!(!is_image_path("audio.mp3"));
    assert!(!is_image_path("noext"));
}
