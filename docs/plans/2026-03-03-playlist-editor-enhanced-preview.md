# Playlist Editor — Enhanced Preview UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the playlist editor into a two-column layout with a large 16:9 preview, seekable progress bar, and a dedicated right-panel item list with thumbnails — replacing the timeline as the primary item management surface.

**Architecture:** Split the editor body into left (preview + transport) and right (item list panel) columns, with the existing timeline strip kept at the bottom as a duration/reorder overview. A new `PlaylistItemPanel` component owns the right column. Media type detection is unified via `resolveIsVideo(item, mediaList)` shared across all components.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 4 (theme tokens), TanStack Query v5, lucide-react icons. No new dependencies.

---

### Task 1: Fix `TimelineBlock` — same broken `isVideo` and add video thumbnails

`TimelineBlock` has the same file-extension regex bug as `PreviewPlayer` (just fixed). It also never shows video thumbnails — just a Film icon. Fix both.

**Files:**
- Modify: `veha-dashboard/src/components/playlist/TimelineBlock.tsx`
- Modify: `veha-dashboard/src/components/playlist/Timeline.tsx`

**Step 1: Add `mediaList` prop to `TimelineBlock` and fix `isVideo`**

Replace the top of `TimelineBlock.tsx` to accept `mediaList` and use `resolveIsVideo`. Since `resolveIsVideo` is already defined in `PreviewPlayer.tsx` (module-private), extract it to a shared util first.

Create `veha-dashboard/src/components/playlist/playlistUtils.ts`:

```ts
import type { MediaItem, Media } from '../../types/api'
import { mediaThumbnailUrl } from '../../api/media'

export function resolveIsVideo(item: MediaItem | null, mediaList?: Media[]): boolean {
  if (!item) return false
  if (mediaList) {
    const match = item.source.match(/\/api\/media\/([^/]+)\/download/)
    if (match) {
      const media = mediaList.find((m) => m.id === match[1])
      if (media) return media.mime_type.startsWith('video/')
    }
  }
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(item.source) ||
         /\.(mp4|webm|mov|avi|mkv)$/i.test(item.name ?? '')
}

export function resolveMediaId(source: string): string | null {
  const match = source.match(/\/api\/media\/([^/]+)\/download/)
  return match ? match[1] : null
}
```

**Step 2: Update `TimelineBlock.tsx`**

Replace the `isVideo` / `isImage` lines and add video thumbnail display:

```tsx
import { resolveIsVideo, resolveMediaId } from './playlistUtils'
import { mediaThumbnailUrl } from '../../api/media'
import type { Media } from '../../types/api'

// Add to props interface:
  mediaList?: Media[]

// In component body, replace:
  const isVideo = resolveIsVideo(item, mediaList)
  const isImage = !isVideo
  const mediaId = resolveMediaId(item.source)

// Replace thumbnail background div:
      <div className="absolute inset-0 bg-bg-elevated">
        {isImage && mediaId ? (
          <img src={item.source} alt="" className="w-full h-full object-cover opacity-60" loading="lazy" />
        ) : isVideo && mediaId ? (
          <img src={mediaThumbnailUrl(mediaId)} alt="" className="w-full h-full object-cover opacity-60" loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-6 h-6 text-text-muted/50" />
          </div>
        )}
      </div>
```

**Step 3: Update `Timeline.tsx` to accept and pass `mediaList`**

Add `mediaList?: Media[]` to `TimelineProps` and thread it through to each `<TimelineBlock mediaList={mediaList} ... />`.

**Step 4: Update `PreviewPlayer.tsx` to import from shared util**

Remove the inline `resolveIsVideo` function and import it from `./playlistUtils`.

**Step 5: Verify build**

```bash
cd veha-dashboard && bun run build 2>&1 | tail -20
```
Expected: no TypeScript errors.

**Step 6: Commit**

```bash
git add veha-dashboard/src/components/playlist/playlistUtils.ts \
        veha-dashboard/src/components/playlist/TimelineBlock.tsx \
        veha-dashboard/src/components/playlist/Timeline.tsx \
        veha-dashboard/src/components/playlist/PreviewPlayer.tsx
git commit -m "fix(playlist): fix isVideo detection in TimelineBlock, show video thumbnails, extract shared util"
```

---

### Task 2: Enhance `PreviewPlayer` — 16:9 aspect ratio + seekable progress bar

**Files:**
- Modify: `veha-dashboard/src/components/playlist/PreviewPlayer.tsx`

**Step 1: Redesign the component**

Replace the entire component body. Key changes:
- Remove fixed `h-48` — use `aspect-video` (16:9) on the media container
- Add a `progress` state (0–1) and a seek slider
- Progress bar: `input[type=range]` 0–1, updates on timer tick and video `timeupdate`
- For images: progress = elapsed/durationSecs
- For video: progress = currentTime/duration (from videoRef)
- Seeking: for images, set `elapsed`; for video, set `videoRef.current.currentTime`

Full replacement of `PreviewPlayer.tsx`:

```tsx
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, ListVideo } from 'lucide-react'
import type { MediaItem, Media } from '../../types/api'
import { resolveIsVideo, resolveMediaId } from './playlistUtils'
import { mediaThumbnailUrl } from '../../api/media'

export interface PreviewPlayerHandle {
  togglePlay: () => void
}

interface PreviewPlayerProps {
  items: MediaItem[]
  selectedIndex: number | null
  onIndexChange: (index: number) => void
  mediaList?: Media[]
}

export const PreviewPlayer = forwardRef<PreviewPlayerHandle, PreviewPlayerProps>(
  function PreviewPlayer({ items, selectedIndex, onIndexChange, mediaList }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [playing, setPlaying] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [sequential, setSequential] = useState(false)
    const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

    const currentIndex = selectedIndex ?? 0
    const currentItem = items[currentIndex] ?? null
    const durationSecs = currentItem?.duration?.secs ?? 10
    const isVideo = resolveIsVideo(currentItem, mediaList)
    const mediaId = currentItem ? resolveMediaId(currentItem.source) : null

    // progress 0–1
    const progress = isVideo
      ? 0  // driven by onTimeUpdate
      : durationSecs > 0 ? Math.min(elapsed / durationSecs, 1) : 0

    const clearTimer = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
    }

    useEffect(() => {
      setElapsed(0)
      setPlaying(false)
      clearTimer()
    }, [currentIndex])

    useEffect(() => { return clearTimer }, [])

    const advanceToNext = useCallback(() => {
      if (currentIndex < items.length - 1) {
        onIndexChange(currentIndex + 1)
      } else {
        setPlaying(false)
        setSequential(false)
      }
    }, [currentIndex, items.length, onIndexChange])

    useEffect(() => {
      if (!playing || isVideo) return
      clearTimer()
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= durationSecs) {
            if (sequential) advanceToNext()
            else setPlaying(false)
            return 0
          }
          return prev + 1
        })
      }, 1000)
      return clearTimer
    }, [playing, isVideo, durationSecs, sequential, advanceToNext])

    const togglePlay = useCallback(() => {
      if (isVideo && videoRef.current) {
        if (playing) videoRef.current.pause()
        else videoRef.current.play()
      }
      setPlaying(!playing)
    }, [playing, isVideo])

    useImperativeHandle(ref, () => ({ togglePlay }), [togglePlay])

    const playAll = () => { setSequential(true); onIndexChange(0); setPlaying(true) }
    const stopAll = () => {
      setSequential(false); setPlaying(false)
      if (isVideo && videoRef.current) videoRef.current.pause()
    }
    const goPrev = () => { if (currentIndex > 0) onIndexChange(currentIndex - 1) }
    const goNext = () => { if (currentIndex < items.length - 1) onIndexChange(currentIndex + 1) }

    const [videoProgress, setVideoProgress] = useState(0)
    const [videoDuration, setVideoDuration] = useState(0)

    const handleSeek = (val: number) => {
      if (isVideo && videoRef.current && videoDuration > 0) {
        videoRef.current.currentTime = val * videoDuration
        setVideoProgress(val)
      } else {
        const seekSecs = Math.round(val * durationSecs)
        setElapsed(seekSecs)
      }
    }

    const displayProgress = isVideo ? videoProgress : progress
    const displayElapsed = isVideo ? Math.floor(videoProgress * videoDuration) : elapsed
    const displayDuration = isVideo ? Math.ceil(videoDuration) : durationSecs

    if (items.length === 0) {
      return (
        <div className="flex items-center justify-center aspect-video bg-bg-surface border border-border-default rounded-xl">
          <div className="flex flex-col items-center gap-2 text-text-muted">
            <ListVideo className="w-10 h-10 opacity-40" />
            <p className="text-sm">Add media to preview</p>
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col bg-bg-surface border border-border-default rounded-xl overflow-hidden">
        {/* 16:9 media display */}
        <div className="relative aspect-video bg-black flex items-center justify-center">
          {currentItem && !isVideo && (
            <img src={currentItem.source} alt={currentItem.name ?? ''} className="absolute inset-0 w-full h-full object-contain" />
          )}
          {currentItem && isVideo && (
            <video
              ref={videoRef}
              src={currentItem.source}
              className="absolute inset-0 w-full h-full object-contain"
              onEnded={() => { if (sequential) advanceToNext(); else setPlaying(false) }}
              onTimeUpdate={() => {
                if (videoRef.current && videoRef.current.duration) {
                  setVideoProgress(videoRef.current.currentTime / videoRef.current.duration)
                }
              }}
              onLoadedMetadata={() => { if (videoRef.current) setVideoDuration(videoRef.current.duration) }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
          {/* Item counter badge */}
          <div className="absolute top-2 right-2 bg-black/60 rounded-md px-2 py-0.5 text-[11px] text-white/80 tabular-nums">
            {currentIndex + 1} / {items.length}
          </div>
          {/* Item name badge */}
          {currentItem?.name && (
            <div className="absolute bottom-2 left-2 bg-black/60 rounded-md px-2 py-0.5 text-[11px] text-white/80 max-w-[60%] truncate">
              {currentItem.name}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-0">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={displayProgress}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-full h-1 accent-accent cursor-pointer"
          />
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-2 px-4 py-2">
          <button onClick={goPrev} disabled={currentIndex <= 0}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer">
            <SkipBack className="w-4 h-4" />
          </button>
          <button onClick={togglePlay}
            className="p-2 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer">
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={goNext} disabled={currentIndex >= items.length - 1}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer">
            <SkipForward className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-muted tabular-nums ml-1">
            {displayElapsed}s / {displayDuration}s
          </span>
          <div className="ml-auto">
            {!sequential ? (
              <button onClick={playAll} className="text-xs text-accent hover:text-accent-hover cursor-pointer">
                Play All
              </button>
            ) : (
              <button onClick={stopAll} className="text-xs text-status-error hover:text-status-error/80 cursor-pointer">
                Stop
              </button>
            )}
          </div>
        </div>
      </div>
    )
  },
)
```

**Step 2: Verify build**

```bash
cd veha-dashboard && bun run build 2>&1 | tail -20
```
Expected: no errors.

**Step 3: Commit**

```bash
git add veha-dashboard/src/components/playlist/PreviewPlayer.tsx
git commit -m "feat(playlist): enhance preview player — 16:9, seekable progress bar, media badges"
```

---

### Task 3: Create `PlaylistItemPanel` — right-column item list

This new component renders the ordered item list with thumbnails, inline duration editing, remove, and drag-to-reorder via drag handles.

**Files:**
- Create: `veha-dashboard/src/components/playlist/PlaylistItemPanel.tsx`

**Full implementation:**

```tsx
import { useRef, useState } from 'react'
import { GripVertical, X, Film, Image as ImageIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MediaItem, Media } from '../../types/api'
import { resolveIsVideo, resolveMediaId } from './playlistUtils'
import { mediaDownloadUrl, mediaThumbnailUrl } from '../../api/media'
import { Button } from '../ui/Button'

interface PlaylistItemPanelProps {
  items: MediaItem[]
  selectedIndex: number | null
  mediaList?: Media[]
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onDuplicate: (index: number) => void
  onDurationChange: (index: number, secs: number) => void
  onReorder: (from: number, to: number) => void
  onAddMedia: () => void
}

export function PlaylistItemPanel({
  items,
  selectedIndex,
  mediaList,
  onSelect,
  onRemove,
  onDuplicate,
  onDurationChange,
  onReorder,
  onAddMedia,
}: PlaylistItemPanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== index) {
      onReorder(dragIndex, index)
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDropIndex(null)
  }

  return (
    <div className="flex flex-col h-full bg-bg-surface border border-border-default rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default flex-shrink-0">
        <span className="text-sm font-medium text-text-primary">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        <Button size="sm" variant="secondary" onClick={onAddMedia}>
          + Add
        </Button>
      </div>

      {/* Item list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted py-10">
            <Film className="w-8 h-8 opacity-30" />
            <p className="text-sm">No items yet</p>
            <button onClick={onAddMedia} className="text-sm text-accent hover:text-accent-hover cursor-pointer">
              Add media →
            </button>
          </div>
        ) : (
          items.map((item, i) => (
            <PlaylistItemRow
              key={i}
              item={item}
              index={i}
              selected={selectedIndex === i}
              isDragging={dragIndex === i}
              isDropTarget={dropIndex === i && dragIndex !== i}
              mediaList={mediaList}
              onSelect={() => onSelect(i)}
              onRemove={() => onRemove(i)}
              onDuplicate={() => onDuplicate(i)}
              onDurationChange={(secs) => onDurationChange(i, secs)}
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

interface RowProps {
  item: MediaItem
  index: number
  selected: boolean
  isDragging: boolean
  isDropTarget: boolean
  mediaList?: Media[]
  onSelect: () => void
  onRemove: () => void
  onDuplicate: () => void
  onDurationChange: (secs: number) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

function PlaylistItemRow({
  item, index, selected, isDragging, isDropTarget, mediaList,
  onSelect, onRemove, onDuplicate, onDurationChange,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: RowProps) {
  const isVideo = resolveIsVideo(item, mediaList)
  const mediaId = resolveMediaId(item.source)
  const durationSecs = item.duration?.secs ?? 10
  const [editingDur, setEditingDur] = useState(false)
  const [draftDur, setDraftDur] = useState(String(durationSecs))

  const commitDur = () => {
    const val = parseInt(draftDur)
    if (val > 0 && val !== durationSecs) onDurationChange(val)
    setEditingDur(false)
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer select-none transition-colors group',
        'border-l-2',
        selected ? 'bg-accent/10 border-l-accent' : 'border-l-transparent hover:bg-bg-elevated',
        isDragging && 'opacity-40',
        isDropTarget && 'border-t-2 border-t-accent',
      )}
    >
      {/* Drag handle */}
      <div className="text-text-muted/40 hover:text-text-muted cursor-grab active:cursor-grabbing flex-shrink-0">
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Index */}
      <span className="text-xs text-text-muted tabular-nums w-4 flex-shrink-0 text-right">
        {index + 1}
      </span>

      {/* Thumbnail */}
      <div className="w-14 h-9 rounded overflow-hidden bg-bg-elevated flex-shrink-0 relative">
        {mediaId && isVideo ? (
          <>
            <img
              src={mediaThumbnailUrl(mediaId)}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <div className="absolute bottom-0 right-0 bg-black/70 rounded-tl px-0.5">
              <Film className="w-2.5 h-2.5 text-white/80" />
            </div>
          </>
        ) : mediaId ? (
          <img
            src={mediaDownloadUrl(mediaId)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-text-muted/40" />
          </div>
        )}
      </div>

      {/* Name */}
      <span className="flex-1 text-sm text-text-primary truncate min-w-0">
        {item.name ?? 'Untitled'}
      </span>

      {/* Duration */}
      {editingDur ? (
        <input
          autoFocus
          type="number"
          min={1}
          value={draftDur}
          onChange={(e) => setDraftDur(e.target.value)}
          onBlur={commitDur}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDur(); e.stopPropagation() }}
          onClick={(e) => e.stopPropagation()}
          className="w-12 bg-bg-elevated rounded px-1.5 py-0.5 text-xs text-text-primary text-center outline-none border border-accent"
        />
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setDraftDur(String(durationSecs))
            setEditingDur(true)
          }}
          className="text-xs text-text-muted hover:text-accent tabular-nums flex-shrink-0 cursor-text"
        >
          {durationSecs}s
        </button>
      )}

      {/* Remove */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="p-1 text-text-muted/0 group-hover:text-text-muted hover:!text-status-error transition-colors cursor-pointer flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
```

**Step 2: Verify build**

```bash
cd veha-dashboard && bun run build 2>&1 | tail -20
```
Expected: no errors.

**Step 3: Commit**

```bash
git add veha-dashboard/src/components/playlist/PlaylistItemPanel.tsx
git commit -m "feat(playlist): add PlaylistItemPanel — thumbnail list with drag-reorder and inline duration edit"
```

---

### Task 4: Rewire `PlaylistEditor` — two-column layout

**Files:**
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx`

**Step 1: Update imports and layout**

In `PlaylistEditor.tsx`:

1. Import `PlaylistItemPanel` from `'../components/playlist/PlaylistItemPanel'`
2. Remove import of `Film` (no longer used directly)
3. Replace the `{/* Main content area */}` section with the two-column layout

```tsx
{/* Main content area — two columns + bottom timeline */}
<div className="flex flex-col flex-1 gap-3 min-h-0">
  {/* Top row: preview (left) + item panel (right) */}
  <div className="flex gap-3 flex-1 min-h-0">
    {/* Preview — left column, fills available height */}
    <div className="flex-1 min-w-0 flex flex-col">
      <PreviewPlayer
        ref={playerRef}
        items={state.items}
        selectedIndex={state.selectedIndex}
        onIndexChange={(i) => dispatch({ type: 'SELECT', index: i })}
        mediaList={mediaList}
      />
    </div>

    {/* Item panel — right column, fixed width */}
    <div className="w-72 flex-shrink-0">
      <PlaylistItemPanel
        items={state.items}
        selectedIndex={state.selectedIndex}
        mediaList={mediaList}
        onSelect={(i) => dispatch({ type: 'SELECT', index: i })}
        onRemove={(i) => dispatch({ type: 'REMOVE_ITEM', index: i })}
        onDuplicate={(i) => dispatch({ type: 'DUPLICATE', index: i })}
        onDurationChange={(i, secs) => dispatch({ type: 'SET_DURATION', index: i, secs })}
        onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
        onAddMedia={() => setShowMediaPicker(true)}
      />
    </div>
  </div>

  {/* Bottom: timeline strip */}
  <div className="flex-shrink-0">
    <Timeline
      items={state.items}
      selectedIndex={state.selectedIndex}
      mediaList={mediaList}
      onSelect={(i) => dispatch({ type: 'SELECT', index: i })}
      onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
      onDurationChange={(i, secs) => dispatch({ type: 'SET_DURATION', index: i, secs })}
      onRemove={(i) => dispatch({ type: 'REMOVE_ITEM', index: i })}
      onDuplicate={(i) => dispatch({ type: 'DUPLICATE', index: i })}
      onAddMedia={() => setShowMediaPicker(true)}
    />
  </div>
</div>
```

4. Remove the `Film` import from `PlaylistEditor.tsx` if it is unused after this change (check the media picker modal — it uses `Film` as fallback icon, so keep it if still referenced there).

**Step 2: Fix media picker modal thumbnails**

The media picker currently shows `<img src={mediaDownloadUrl(media.id)}>` for images — that's correct. For videos it uses `mediaThumbnailUrl` — also correct. No changes needed.

**Step 3: Verify build + type-check**

```bash
cd veha-dashboard && bun run build 2>&1 | tail -30
```
Expected: clean build.

**Step 4: Manual smoke test in browser**

```bash
# In one terminal:
RUST_LOG=info cargo run -p veha-api -- --bind 0.0.0.0:3000 --database veha.db --media-dir media

# In another:
cd veha-dashboard && bun run dev
```

Open `http://localhost:5173/playlists`, open a playlist with items. Verify:
- [ ] Two-column layout: large preview left, item list right
- [ ] Preview shows 16:9 ratio
- [ ] Progress bar visible and draggable
- [ ] Videos in preview play correctly (not rendered as img)
- [ ] Item list shows thumbnails (images: direct, videos: ffmpeg thumbnail)
- [ ] Clicking a row selects the item and preview jumps to it
- [ ] Duration click → inline edit → Enter commits
- [ ] X button removes item
- [ ] Drag-reorder in item panel works
- [ ] Timeline strip at bottom still works (zoom, reorder)
- [ ] Video thumbnails appear in timeline blocks
- [ ] "Add Media" opens picker from both item panel and timeline

**Step 5: Commit**

```bash
git add veha-dashboard/src/pages/PlaylistEditor.tsx
git commit -m "feat(playlist): two-column editor layout — large preview + item panel + timeline strip"
```

---

### Task 5: Polish — media picker improvements

The current media picker modal is a simple grid. Improve it: larger thumbnails, file size/type info, better selected state when you hover.

**Files:**
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx` (media picker section only)

**Step 1: Update the modal grid**

Replace the media picker grid content in the `<Modal>` with:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
  {mediaList.map((media) => (
    <button
      key={media.id}
      onClick={() => addMediaItem(media.id)}
      className="group rounded-lg border border-border-default hover:border-accent overflow-hidden transition-all cursor-pointer text-left"
    >
      <div className="aspect-video bg-bg-elevated overflow-hidden relative">
        {media.mime_type.startsWith('image/') ? (
          <img
            src={mediaDownloadUrl(media.id)}
            alt={media.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
        ) : media.mime_type.startsWith('video/') ? (
          <img
            src={mediaThumbnailUrl(media.id)}
            alt={media.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-text-muted" />
          </div>
        )}
        {media.mime_type.startsWith('video/') && (
          <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1 py-0.5">
            <Film className="w-3 h-3 text-white/80" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs text-text-primary truncate font-medium">{media.name}</p>
        <p className="text-[10px] text-text-muted mt-0.5">
          {(media.size / 1024 / 1024).toFixed(1)} MB
        </p>
      </div>
    </button>
  ))}
</div>
```

**Step 2: Verify build**

```bash
cd veha-dashboard && bun run build 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add veha-dashboard/src/pages/PlaylistEditor.tsx
git commit -m "feat(playlist): improve media picker — larger thumbnails, file size, hover zoom"
```

---

## Summary of Changes

| File | Change |
|---|---|
| `playlistUtils.ts` (new) | Shared `resolveIsVideo` + `resolveMediaId` util |
| `TimelineBlock.tsx` | Fix `isVideo`, show video thumbnails |
| `Timeline.tsx` | Thread `mediaList` to blocks |
| `PreviewPlayer.tsx` | 16:9, seekable progress bar, import from utils |
| `PlaylistItemPanel.tsx` (new) | Right-panel item list with thumbnails + reorder |
| `PlaylistEditor.tsx` | Two-column layout, wire up item panel, improved media picker |
