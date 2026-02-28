use mepl_core::{VideoFrame, OutputSink};
use mepl_output::NullSink;

#[test]
fn test_null_sink_counts_frames() {
    let mut sink = NullSink::new(320, 240);
    assert_eq!(sink.frame_count(), 0);
    assert!(sink.is_open());
    assert_eq!(sink.resolution(), (320, 240));

    let frame = VideoFrame::new(320, 240);
    sink.write_frame(&frame).unwrap();
    sink.write_frame(&frame).unwrap();
    sink.write_frame(&frame).unwrap();

    assert_eq!(sink.frame_count(), 3);
    assert!(sink.is_open());
}

#[test]
fn test_null_sink_max_frames() {
    let mut sink = NullSink::with_max_frames(320, 240, 2);
    let frame = VideoFrame::new(320, 240);

    sink.write_frame(&frame).unwrap();
    assert!(sink.is_open());

    sink.write_frame(&frame).unwrap();
    assert!(!sink.is_open()); // should close after 2 frames

    assert_eq!(sink.frame_count(), 2);
}
