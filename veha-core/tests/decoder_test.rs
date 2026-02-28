use veha_core::{Decoder, VideoFrame};

const TEST_VIDEO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/test.mp4");

#[test]
fn test_decode_test_video() {
    veha_core::init().unwrap();

    let decoder = Decoder::open_native(TEST_VIDEO).unwrap();
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
}

#[test]
fn test_decode_with_scaling() {
    veha_core::init().unwrap();

    let decoder = Decoder::open(TEST_VIDEO, 160, 120).unwrap();
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
    let mut frame = VideoFrame::new(2, 2).unwrap();
    frame.data[0] = 255; // R
    frame.data[1] = 0;   // G
    frame.data[2] = 0;   // B

    let argb = frame.to_argb_u32();
    assert_eq!(argb[0], 0x00FF0000); // Red in ARGB
}

#[test]
fn test_timestamp_secs() {
    let mut frame = VideoFrame::new(1, 1).unwrap();
    frame.pts = Some(90);
    frame.time_base = (1, 30);
    let ts = frame.timestamp_secs().unwrap();
    assert!((ts - 3.0).abs() < 0.001);

    // No PTS
    frame.pts = None;
    assert!(frame.timestamp_secs().is_none());
}
