use mepl_core::{Decoder, VideoFrame};

#[test]
fn test_decode_test_video() {
    mepl_core::init();

    let decoder = Decoder::open_native("tests/fixtures/test.mp4").unwrap();
    let (w, h) = decoder.target_resolution();
    assert_eq!(w, 320);
    assert_eq!(h, 240);

    let mut frame_count = 0;
    for frame_result in decoder {
        let frame = frame_result.unwrap();
        assert_eq!(frame.width, 320);
        assert_eq!(frame.height, 240);
        assert_eq!(frame.data.len(), (320 * 240 * 3) as usize);
        frame_count += 1;
    }

    assert!(frame_count > 0, "Should have decoded at least one frame");
    println!("Decoded {frame_count} frames");
}

#[test]
fn test_decode_with_scaling() {
    mepl_core::init();

    let decoder = Decoder::open("tests/fixtures/test.mp4", 160, 120).unwrap();
    let (w, h) = decoder.target_resolution();
    assert_eq!(w, 160);
    assert_eq!(h, 120);

    let mut frame_count = 0;
    for frame_result in decoder {
        let frame = frame_result.unwrap();
        assert_eq!(frame.width, 160);
        assert_eq!(frame.height, 120);
        assert_eq!(frame.data.len(), (160 * 120 * 3) as usize);
        frame_count += 1;
    }

    assert!(frame_count > 0);
}

#[test]
fn test_frame_to_argb() {
    let mut frame = VideoFrame::new(2, 2);
    // Set pixel (0,0) to red: R=255, G=0, B=0
    frame.data[0] = 255;
    frame.data[1] = 0;
    frame.data[2] = 0;

    let argb = frame.to_argb_u32();
    assert_eq!(argb[0], 0x00FF0000); // Red in ARGB
}
