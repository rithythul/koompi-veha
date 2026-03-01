# Playlist Timeline Editor — Design

## Problem

The current playlist editor is a basic CRUD modal: text fields, up/down buttons for reordering, no thumbnails, no preview playback. Operators managing billboard content daily need a fast, visual editing experience.

## Target Users

Primary: operators / ad ops staff managing content daily.
Future: advertisers / clients assembling their own campaigns (must be intuitive).

## Approach: Timeline Editor

A horizontal timeline-based editor where each media item is a visual block. Width proportional to duration. Drag to reorder, resize to change duration. Thumbnail on each block. Full-width preview player above the timeline.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  TOOLBAR                                                │
│  [< Back]  "Playlist Name" (editable)  [Loop]  [Save]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│              PREVIEW PLAYER (full width)                │
│         (shows selected item or sequential playback)    │
│                                                         │
│          |<   Play/Pause   >|    0:12 / 0:45            │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  TIMELINE                                               │
│  [- zoom +]                    Total: 2m 45s  8 items   │
│  ┌──────────┐┌───────────────────┐┌────┐┌──────────┐   │
│  │  beach   ││  promo.mp4       ││ ad ││  sunset  │   │
│  │   10s    ││   45s             ││ 5s ││   15s    │   │
│  └──────────┘└───────────────────┘└────┘└──────────┘   │
│  [+ Add Media]                                          │
└─────────────────────────────────────────────────────────┘
```

- No separate properties panel — duration editable inline on blocks
- Right-click context menu: Remove, Duplicate, Replace Media
- Thumbnails on each block (image thumbnail or video poster icon)
- Selected block highlighted with accent border

## Timeline Interactions

- **Drag to reorder:** Grab a block, drag left/right. Drop indicator shows position.
- **Resize duration (images only):** Drag right edge of image block. Video duration is fixed.
- **Inline duration edit:** Click duration text on image block → input field → Enter to confirm.
- **Zoom:** Slider scales the timeline. Min zoom fits all items. Max zoom ~50px per second.
- **Add Media:** Popover with media library thumbnails. Click to append. Default image duration: 10s.
- **Selection:** Click to select → plays in preview. Shift+click for multi-select.
- **Keyboard shortcuts:** Delete (remove), Space (play/pause), Left/Right (navigate), D (duplicate).

## Preview Player

Pure HTML5, no WASM:
- Images: `<img>` tag, countdown timer, auto-advance after duration
- Videos: `<video>` tag with native playback, advance on end
- Controls: Previous | Play/Pause | Next | progress bar
- Two modes: single-item preview (click a block) and full playlist preview (plays all sequentially, highlights active block on timeline)

## Component Architecture

```
PlaylistEditor (page: /playlists/:id/edit)
├── PlaylistToolbar (name, loop, save)
├── PreviewPlayer (video/img, transport controls, progress)
├── Timeline
│   ├── TimelineControls (zoom, total duration, item count)
│   ├── TimelineTrack (horizontal scrollable)
│   │   └── TimelineBlock[] (draggable, resizable, thumbnail)
│   └── AddMediaButton → MediaPickerPopover
└── MediaPickerPopover (searchable grid of media library)
```

## State Management

Single `useReducer` for playlist editing state:
- `items[]` — ordered media items with durations
- `selectedIds` — currently selected block IDs
- `playbackIndex` — which item is playing in preview
- Actions: REORDER, RESIZE, ADD, REMOVE, DUPLICATE, SELECT, SET_DURATION

Load via `usePlaylist(id)`, save explicitly via `useUpdatePlaylist()`. No auto-save.

## Out of Scope

- Undo/redo
- Video trim/split
- Audio waveform
- Multi-track timeline
- Transitions/effects
- Collaborative editing
