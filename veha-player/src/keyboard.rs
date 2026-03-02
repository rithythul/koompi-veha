use veha_core::sink::{SinkEvent, SinkKey};

/// Actions that can be triggered by keyboard input.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum KeyAction {
    PlayPause,
    SeekForward,
    SeekBackward,
    VolumeUp,
    VolumeDown,
    Mute,
    ToggleFullscreen,
    Next,
    Previous,
    SpeedUp,
    SpeedDown,
    SeekPercent(u8),
    Quit,
}

/// Map sink events to player key actions.
pub fn map_events(events: &[SinkEvent]) -> Vec<KeyAction> {
    events
        .iter()
        .filter_map(|ev| match ev {
            SinkEvent::KeyPressed(key) => map_key(*key),
        })
        .collect()
}

fn map_key(key: SinkKey) -> Option<KeyAction> {
    match key {
        SinkKey::Space | SinkKey::K => Some(KeyAction::PlayPause),
        SinkKey::Left => Some(KeyAction::SeekBackward),
        SinkKey::Right => Some(KeyAction::SeekForward),
        SinkKey::Up => Some(KeyAction::VolumeUp),
        SinkKey::Down => Some(KeyAction::VolumeDown),
        SinkKey::M => Some(KeyAction::Mute),
        SinkKey::F => Some(KeyAction::ToggleFullscreen),
        SinkKey::N => Some(KeyAction::Next),
        SinkKey::P => Some(KeyAction::Previous),
        SinkKey::Period => Some(KeyAction::SpeedUp),
        SinkKey::Comma => Some(KeyAction::SpeedDown),
        SinkKey::Escape => Some(KeyAction::Quit),
        SinkKey::Num0 => Some(KeyAction::SeekPercent(0)),
        SinkKey::Num1 => Some(KeyAction::SeekPercent(10)),
        SinkKey::Num2 => Some(KeyAction::SeekPercent(20)),
        SinkKey::Num3 => Some(KeyAction::SeekPercent(30)),
        SinkKey::Num4 => Some(KeyAction::SeekPercent(40)),
        SinkKey::Num5 => Some(KeyAction::SeekPercent(50)),
        SinkKey::Num6 => Some(KeyAction::SeekPercent(60)),
        SinkKey::Num7 => Some(KeyAction::SeekPercent(70)),
        SinkKey::Num8 => Some(KeyAction::SeekPercent(80)),
        SinkKey::Num9 => Some(KeyAction::SeekPercent(90)),
    }
}
