# Playlist Timeline Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the basic playlist CRUD modal with a full-page timeline editor featuring drag-to-reorder, resize-to-set-duration, thumbnail previews, and an inline media preview player.

**Architecture:** New route `/playlists/:id/edit` renders a `PlaylistEditor` page with three zones: toolbar (name/loop/save), preview player (HTML5 video/img), and horizontal timeline (draggable/resizable blocks with thumbnails). State managed via `useReducer`. Existing Playlists list page gets "Edit" links pointing to the new route. No new npm dependencies — drag/resize implemented with native pointer events.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, TanStack Query, native Pointer Events API for drag/resize, HTML5 `<video>`/`<img>` for preview.

**Design doc:** `docs/plans/2026-03-01-playlist-timeline-editor-design.md`

---

### Task 1: Add route and create PlaylistEditor page shell

**Files:**
- Create: `veha-dashboard/src/pages/PlaylistEditor.tsx`
- Modify: `veha-dashboard/src/App.tsx`
- Modify: `veha-dashboard/src/components/layout/Header.tsx`

**Step 1: Create the editor page shell**

Create `veha-dashboard/src/pages/PlaylistEditor.tsx`:

```tsx
import { useParams, useNavigate } from 'react-router-dom'
import { usePlaylist, useUpdatePlaylist } from '../api/playlists'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useReducer, useCallback } from 'react'
import type { MediaItem, CreatePlaylist } from '../types/api'

// --- Reducer ---

interface EditorState {
  name: string
  loop: boolean
  items: MediaItem[]
  selectedIndex: number | null
  dirty: boolean
}

type EditorAction =
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_LOOP'; loop: boolean }
  | { type: 'SET_ITEMS'; items: MediaItem[] }
  | { type: 'ADD_ITEM'; item: MediaItem }
  | { type: 'REMOVE_ITEM'; index: number }
  | { type: 'REORDER'; from: number; to: number }
  | { type: 'SET_DURATION'; index: number; secs: number }
  | { type: 'DUPLICATE'; index: number }
  | { type: 'SELECT'; index: number | null }
  | { type: 'INIT'; state: Omit<EditorState, 'selectedIndex' | 'dirty'> }

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_NAME':
      return { ...state, name: action.name, dirty: true }
    case 'SET_LOOP':
      return { ...state, loop: action.loop, dirty: true }
    case 'SET_ITEMS':
      return { ...state, items: action.items, dirty: true }
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.item], dirty: true }
    case 'REMOVE_ITEM': {
      const items = state.items.filter((_, i) => i !== action.index)
      const sel = state.selectedIndex === action.index ? null : state.selectedIndex
      return { ...state, items, selectedIndex: sel, dirty: true }
    }
    case 'REORDER': {
      const items = [...state.items]
      const [moved] = items.splice(action.from, 1)
      items.splice(action.to, 0, moved)
      const sel = state.selectedIndex === action.from ? action.to : state.selectedIndex
      return { ...state, items, selectedIndex: sel, dirty: true }
    }
    case 'SET_DURATION': {
      const items = [...state.items]
      items[action.index] = { ...items[action.index], duration: { secs: action.secs, nanos: 0 } }
      return { ...state, items, dirty: true }
    }
    case 'DUPLICATE': {
      const items = [...state.items]
      items.splice(action.index + 1, 0, { ...items[action.index] })
      return { ...state, items, dirty: true }
    }
    case 'SELECT':
      return { ...state, selectedIndex: action.index }
    case 'INIT':
      return { ...action.state, selectedIndex: null, dirty: false }
    default:
      return state
  }
}

const initialState: EditorState = {
  name: '',
  loop: false,
  items: [],
  selectedIndex: null,
  dirty: false,
}

// --- Page ---

export default function PlaylistEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: playlist, isLoading } = usePlaylist(id ?? '')
  const updatePlaylist = useUpdatePlaylist(id ?? '')

  const [state, dispatch] = useReducer(editorReducer, initialState)

  // Initialize state from loaded playlist (once)
  const initialized = useCallback(() => {
    if (playlist && !state.dirty && state.name === '') {
      dispatch({
        type: 'INIT',
        state: { name: playlist.name, loop: playlist.loop_playlist, items: [...playlist.items] },
      })
    }
  }, [playlist, state.dirty, state.name])
  initialized()

  const handleSave = () => {
    const payload: CreatePlaylist = {
      name: state.name,
      items: state.items,
      loop_playlist: state.loop,
    }
    updatePlaylist.mutate(payload, {
      onSuccess: () => {
        toast.success('Playlist saved')
        dispatch({ type: 'INIT', state: { name: state.name, loop: state.loop, items: state.items } })
      },
      onError: (err) => toast.error(err.message),
    })
  }

  if (isLoading) return <PageSpinner />
  if (!playlist) return <p className="text-text-muted p-8">Playlist not found.</p>

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border-default bg-bg-surface flex-shrink-0">
        <button
          onClick={() => navigate('/playlists')}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Playlists
        </button>
        <input
          value={state.name}
          onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
          className="bg-transparent text-lg font-semibold text-text-primary border-none outline-none flex-1 min-w-0"
          placeholder="Playlist name"
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(e) => dispatch({ type: 'SET_LOOP', loop: e.target.checked })}
            className="accent-accent"
          />
          <span className="text-sm text-text-secondary">Loop</span>
        </label>
        <button
          onClick={handleSave}
          disabled={!state.dirty || !state.name.trim() || updatePlaylist.isPending}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer"
        >
          {updatePlaylist.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Preview Player — placeholder */}
      <div className="flex-shrink-0 bg-bg-primary border-b border-border-default flex items-center justify-center h-64">
        <p className="text-text-muted text-sm">Preview player (Task 3)</p>
      </div>

      {/* Timeline — placeholder */}
      <div className="flex-1 min-h-0 bg-bg-primary p-4">
        <p className="text-text-muted text-sm">Timeline (Task 2)</p>
        <p className="text-text-muted text-xs mt-1">{state.items.length} items</p>
      </div>
    </div>
  )
}
```

**Step 2: Add route in App.tsx**

In `veha-dashboard/src/App.tsx`, add lazy import and route:

After line `const Playlists = lazy(...)`:
```tsx
const PlaylistEditor = lazy(() => import('./pages/PlaylistEditor'))
```

Inside the `<Route element={<AppLayout />}>` block, after the playlists route:
```tsx
<Route path="/playlists/:id/edit" element={<PlaylistEditor />} />
```

**Step 3: Add page title for the editor route**

In `veha-dashboard/src/components/layout/Header.tsx`, add to `pageTitles`:
```ts
'/playlists': 'Playlists',
```

And add a detail-page override after the existing ones:
```ts
if (location.pathname.match(/^\/playlists\/.+\/edit/)) displayTitle = 'Edit Playlist'
```

**Step 4: Add "Edit" link to Playlists page**

In `veha-dashboard/src/pages/Playlists.tsx`, change the edit button's `onClick` handler from `openEdit(pl)` to navigate to the new editor page:

Replace:
```tsx
<Button variant="ghost" size="sm" onClick={() => openEdit(pl)}>
  <Pencil className="w-3.5 h-3.5" />
</Button>
```

With:
```tsx
<Button variant="ghost" size="sm" onClick={() => navigate(`/playlists/${pl.id}/edit`)}>
  <Pencil className="w-3.5 h-3.5" />
</Button>
```

Add `useNavigate` import and call at the top of the component.

Keep the modal-based create flow (for new playlists) — the timeline editor is only for editing existing playlists.

**Step 5: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors. Navigate to `/playlists`, click edit on a playlist, see the editor shell with toolbar + placeholders.

**Step 6: Commit**

```bash
git add veha-dashboard/src/pages/PlaylistEditor.tsx veha-dashboard/src/App.tsx veha-dashboard/src/components/layout/Header.tsx veha-dashboard/src/pages/Playlists.tsx
git commit -m "feat(dashboard): add PlaylistEditor page shell with route and reducer"
```

---

### Task 2: Build the Timeline component with draggable blocks

**Files:**
- Create: `veha-dashboard/src/components/playlist/Timeline.tsx`
- Create: `veha-dashboard/src/components/playlist/TimelineBlock.tsx`
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx`

**Step 1: Create TimelineBlock component**

Create `veha-dashboard/src/components/playlist/TimelineBlock.tsx`:

```tsx
import { useRef, useState } from 'react'
import { Film, Image as ImageIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MediaItem } from '../../types/api'

interface TimelineBlockProps {
  item: MediaItem
  index: number
  selected: boolean
  pixelsPerSecond: number
  onSelect: () => void
  onDurationChange: (secs: number) => void
  onDragStart: (index: number) => void
  onContextMenu: (e: React.MouseEvent, index: number) => void
}

export function TimelineBlock({
  item,
  index,
  selected,
  pixelsPerSecond,
  onSelect,
  onDurationChange,
  onDragStart,
  onContextMenu,
}: TimelineBlockProps) {
  const durationSecs = item.duration?.secs ?? 10
  const width = Math.max(durationSecs * pixelsPerSecond, 48)
  const isImage = !item.source.match(/\.(mp4|webm)$/i)
  const [resizing, setResizing] = useState(false)
  const startXRef = useRef(0)
  const startDurationRef = useRef(durationSecs)

  const handleResizeStart = (e: React.PointerEvent) => {
    if (!isImage) return // can't resize videos
    e.stopPropagation()
    e.preventDefault()
    setResizing(true)
    startXRef.current = e.clientX
    startDurationRef.current = durationSecs
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizing) return
    const dx = e.clientX - startXRef.current
    const newSecs = Math.max(1, Math.round(startDurationRef.current + dx / pixelsPerSecond))
    onDurationChange(newSecs)
  }

  const handleResizeEnd = () => {
    setResizing(false)
  }

  // Thumbnail: show actual image for images, icon for videos
  const thumbSrc = isImage ? item.source : null

  return (
    <div
      data-index={index}
      className={cn(
        'relative h-full rounded-lg overflow-hidden flex-shrink-0 cursor-pointer select-none group border-2 transition-colors',
        selected ? 'border-accent' : 'border-transparent hover:border-border-hover',
      )}
      style={{ width }}
      onClick={onSelect}
      onPointerDown={() => onDragStart(index)}
      onContextMenu={(e) => onContextMenu(e, index)}
    >
      {/* Thumbnail background */}
      <div className="absolute inset-0 bg-bg-elevated">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="w-full h-full object-cover opacity-60" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-6 h-6 text-text-muted/50" />
          </div>
        )}
      </div>

      {/* Content overlay */}
      <div className="relative z-10 h-full flex flex-col justify-between p-1.5">
        <div className="flex items-center gap-1">
          {isImage ? (
            <ImageIcon className="w-3 h-3 text-text-secondary flex-shrink-0" />
          ) : (
            <Film className="w-3 h-3 text-text-secondary flex-shrink-0" />
          )}
          <span className="text-[10px] font-medium text-text-primary truncate drop-shadow-sm">
            {item.name ?? 'Untitled'}
          </span>
        </div>
        <span className="text-[10px] text-text-secondary tabular-nums drop-shadow-sm">{durationSecs}s</span>
      </div>

      {/* Resize handle (images only) */}
      {isImage && (
        <div
          className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-accent/30 transition-colors"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}
    </div>
  )
}
```

**Step 2: Create Timeline component**

Create `veha-dashboard/src/components/playlist/Timeline.tsx`:

```tsx
import { useRef, useState, useCallback } from 'react'
import { Plus, ZoomIn, ZoomOut } from 'lucide-react'
import { TimelineBlock } from './TimelineBlock'
import { cn } from '../../lib/utils'
import type { MediaItem } from '../../types/api'

interface TimelineProps {
  items: MediaItem[]
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  onReorder: (from: number, to: number) => void
  onDurationChange: (index: number, secs: number) => void
  onRemove: (index: number) => void
  onDuplicate: (index: number) => void
  onAddMedia: () => void
}

export function Timeline({
  items,
  selectedIndex,
  onSelect,
  onReorder,
  onDurationChange,
  onRemove,
  onDuplicate,
  onAddMedia,
}: TimelineProps) {
  const [zoom, setZoom] = useState(8) // pixels per second
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const totalSeconds = items.reduce((acc, item) => acc + (item.duration?.secs ?? 10), 0)
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIndex === null) return
      const track = trackRef.current
      if (!track) return
      const blocks = track.querySelectorAll<HTMLElement>('[data-index]')
      let targetIndex = items.length
      for (const block of blocks) {
        const rect = block.getBoundingClientRect()
        if (e.clientX < rect.left + rect.width / 2) {
          targetIndex = parseInt(block.dataset.index!)
          break
        }
      }
      setDropIndex(targetIndex)
    },
    [dragIndex, items.length],
  )

  const handlePointerUp = useCallback(() => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex
      if (to !== dragIndex) onReorder(dragIndex, to)
    }
    setDragIndex(null)
    setDropIndex(null)
  }, [dragIndex, dropIndex, onReorder])

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, index })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedIndex === null) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onRemove(selectedIndex)
      } else if (e.key === 'd') {
        onDuplicate(selectedIndex)
      } else if (e.key === 'ArrowLeft' && selectedIndex > 0) {
        onSelect(selectedIndex - 1)
      } else if (e.key === 'ArrowRight' && selectedIndex < items.length - 1) {
        onSelect(selectedIndex + 1)
      }
    },
    [selectedIndex, items.length, onRemove, onDuplicate, onSelect],
  )

  return (
    <div
      className="flex flex-col h-full"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (contextMenu) closeContextMenu()
        // click on background deselects
        if ((e.target as HTMLElement).dataset.timeline === 'bg') onSelect(null)
      }}
    >
      {/* Timeline toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(2, z - 2))}
            className="p-1 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={2}
            max={30}
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            className="w-24 accent-accent"
          />
          <button
            onClick={() => setZoom((z) => Math.min(30, z + 2))}
            className="p-1 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span>{items.length} items</span>
          <span className="tabular-nums">{formatTime(totalSeconds)}</span>
        </div>
      </div>

      {/* Timeline track */}
      <div
        className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4"
        data-timeline="bg"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div ref={trackRef} className="flex items-stretch gap-1 h-20">
          {items.map((item, i) => (
            <div key={i} className="relative">
              {/* Drop indicator */}
              {dragIndex !== null && dropIndex === i && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent -translate-x-1 z-20" />
              )}
              <TimelineBlock
                item={item}
                index={i}
                selected={selectedIndex === i}
                pixelsPerSecond={zoom}
                onSelect={() => onSelect(i)}
                onDurationChange={(secs) => onDurationChange(i, secs)}
                onDragStart={handleDragStart}
                onContextMenu={handleContextMenu}
              />
            </div>
          ))}
          {/* Drop indicator at end */}
          {dragIndex !== null && dropIndex === items.length && (
            <div className="w-0.5 bg-accent self-stretch" />
          )}

          {/* Add button */}
          <button
            onClick={onAddMedia}
            className={cn(
              'h-20 w-16 flex-shrink-0 rounded-lg border-2 border-dashed border-border-default',
              'flex flex-col items-center justify-center gap-1',
              'text-text-muted hover:text-accent hover:border-accent transition-colors cursor-pointer',
            )}
          >
            <Plus className="w-5 h-5" />
            <span className="text-[10px]">Add</span>
          </button>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-elevated cursor-pointer"
              onClick={() => {
                onDuplicate(contextMenu.index)
                closeContextMenu()
              }}
            >
              Duplicate
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-status-error hover:bg-bg-elevated cursor-pointer"
              onClick={() => {
                onRemove(contextMenu.index)
                closeContextMenu()
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

**Step 3: Wire Timeline into PlaylistEditor**

In `PlaylistEditor.tsx`, replace the timeline placeholder with the real component. Import `Timeline` and `MediaPickerPopover` (reuse from existing, or create a simple one).

Replace the timeline placeholder section with:

```tsx
import { Timeline } from '../components/playlist/Timeline'
import { useMedia, mediaDownloadUrl } from '../api/media'
import { Modal } from '../components/ui/Modal'
```

Add media picker state and handler:

```tsx
const [showMediaPicker, setShowMediaPicker] = useState(false)
const { data: mediaData } = useMedia({ per_page: 200 })
const mediaList = mediaData?.data ?? []

const addMediaItem = (mediaId: string) => {
  const media = mediaList.find((m) => m.id === mediaId)
  if (!media) return
  dispatch({
    type: 'ADD_ITEM',
    item: { source: mediaDownloadUrl(mediaId), name: media.name, duration: { secs: 10, nanos: 0 } },
  })
}
```

Replace timeline placeholder div with:

```tsx
<div className="flex-1 min-h-0 bg-bg-primary">
  <Timeline
    items={state.items}
    selectedIndex={state.selectedIndex}
    onSelect={(i) => dispatch({ type: 'SELECT', index: i })}
    onReorder={(from, to) => dispatch({ type: 'REORDER', from, to })}
    onDurationChange={(i, secs) => dispatch({ type: 'SET_DURATION', index: i, secs })}
    onRemove={(i) => dispatch({ type: 'REMOVE_ITEM', index: i })}
    onDuplicate={(i) => dispatch({ type: 'DUPLICATE', index: i })}
    onAddMedia={() => setShowMediaPicker(true)}
  />
</div>

{/* Media Picker */}
<Modal open={showMediaPicker} onClose={() => setShowMediaPicker(false)} title="Add Media">
  <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
    {mediaList.map((media) => (
      <button
        key={media.id}
        onClick={() => { addMediaItem(media.id); setShowMediaPicker(false) }}
        className="rounded-lg border border-border-default hover:border-accent overflow-hidden transition-colors cursor-pointer"
      >
        {media.mime_type.startsWith('image/') ? (
          <img src={mediaDownloadUrl(media.id)} alt={media.name} className="aspect-video object-cover w-full" loading="lazy" />
        ) : (
          <div className="aspect-video bg-bg-elevated flex items-center justify-center">
            <Film className="w-6 h-6 text-text-muted" />
          </div>
        )}
        <p className="text-[10px] text-text-primary truncate px-2 py-1">{media.name}</p>
      </button>
    ))}
  </div>
</Modal>
```

**Step 4: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors. Navigate to `/playlists/:id/edit`, see working timeline with blocks, drag to reorder, right-click context menu, zoom slider.

**Step 5: Commit**

```bash
git add veha-dashboard/src/components/playlist/Timeline.tsx veha-dashboard/src/components/playlist/TimelineBlock.tsx veha-dashboard/src/pages/PlaylistEditor.tsx
git commit -m "feat(dashboard): add Timeline component with drag-to-reorder and resize"
```

---

### Task 3: Build the PreviewPlayer component

**Files:**
- Create: `veha-dashboard/src/components/playlist/PreviewPlayer.tsx`
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx`

**Step 1: Create PreviewPlayer**

Create `veha-dashboard/src/components/playlist/PreviewPlayer.tsx`:

```tsx
import { useRef, useState, useEffect, useCallback } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MediaItem } from '../../types/api'

interface PreviewPlayerProps {
  items: MediaItem[]
  selectedIndex: number | null
  onIndexChange: (index: number) => void
}

export function PreviewPlayer({ items, selectedIndex, onIndexChange }: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sequentialMode, setSequentialMode] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const currentIndex = selectedIndex ?? 0
  const currentItem = items[currentIndex] ?? null
  const durationSecs = currentItem?.duration?.secs ?? 10
  const isVideo = currentItem?.source.match(/\.(mp4|webm)$/i)
  const isImage = currentItem && !isVideo

  // Clear timer on unmount or item change
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Reset elapsed when item changes
  useEffect(() => {
    setElapsed(0)
    setPlaying(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [currentIndex])

  const advanceToNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      onIndexChange(currentIndex + 1)
    } else {
      setPlaying(false)
      setSequentialMode(false)
    }
  }, [currentIndex, items.length, onIndexChange])

  // Image timer: count up and auto-advance
  useEffect(() => {
    if (!playing || !isImage) return
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        if (prev + 1 >= durationSecs) {
          if (sequentialMode) advanceToNext()
          else setPlaying(false)
          return 0
        }
        return prev + 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing, isImage, durationSecs, sequentialMode, advanceToNext])

  const togglePlay = () => {
    if (isVideo && videoRef.current) {
      if (playing) videoRef.current.pause()
      else videoRef.current.play()
    }
    setPlaying(!playing)
  }

  const playAll = () => {
    setSequentialMode(true)
    onIndexChange(0)
    setPlaying(true)
  }

  const handleVideoEnded = () => {
    if (sequentialMode) advanceToNext()
    else setPlaying(false)
  }

  const handleVideoTimeUpdate = () => {
    if (videoRef.current) setElapsed(Math.floor(videoRef.current.currentTime))
  }

  const goPrev = () => { if (currentIndex > 0) onIndexChange(currentIndex - 1) }
  const goNext = () => { if (currentIndex < items.length - 1) onIndexChange(currentIndex + 1) }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 bg-bg-primary border-b border-border-default">
        <p className="text-text-muted text-sm">Add media to preview</p>
      </div>
    )
  }

  return (
    <div className="bg-bg-primary border-b border-border-default flex-shrink-0">
      {/* Media display */}
      <div className="flex items-center justify-center h-52 bg-black/30">
        {isImage && currentItem ? (
          <img src={currentItem.source} alt={currentItem.name ?? ''} className="max-h-full max-w-full object-contain" />
        ) : isVideo && currentItem ? (
          <video
            ref={videoRef}
            src={currentItem.source}
            className="max-h-full max-w-full object-contain"
            onEnded={handleVideoEnded}
            onTimeUpdate={handleVideoTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : null}
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3 py-2 px-4">
        <button onClick={goPrev} disabled={currentIndex <= 0} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={togglePlay} className="p-2 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button onClick={goNext} disabled={currentIndex >= items.length - 1} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
          <SkipForward className="w-4 h-4" />
        </button>
        <span className="text-xs text-text-muted tabular-nums ml-3">
          {elapsed}s / {isVideo ? '~' : ''}{durationSecs}s
        </span>
        <span className="text-xs text-text-muted ml-2">
          ({currentIndex + 1} / {items.length})
        </span>
        {!sequentialMode && (
          <button
            onClick={playAll}
            className="ml-auto text-xs text-accent hover:text-accent-hover cursor-pointer"
          >
            Play All
          </button>
        )}
        {sequentialMode && (
          <button
            onClick={() => { setSequentialMode(false); setPlaying(false) }}
            className="ml-auto text-xs text-status-error hover:text-status-error/80 cursor-pointer"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Wire into PlaylistEditor**

In `PlaylistEditor.tsx`, replace the preview player placeholder with:

```tsx
import { PreviewPlayer } from '../components/playlist/PreviewPlayer'
```

Replace the preview placeholder div with:
```tsx
<PreviewPlayer
  items={state.items}
  selectedIndex={state.selectedIndex}
  onIndexChange={(i) => dispatch({ type: 'SELECT', index: i })}
/>
```

**Step 3: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors. Navigate to editor, click a timeline block — see it preview. Click Play — image counts down. Click "Play All" — sequences through all items.

**Step 4: Commit**

```bash
git add veha-dashboard/src/components/playlist/PreviewPlayer.tsx veha-dashboard/src/pages/PlaylistEditor.tsx
git commit -m "feat(dashboard): add PreviewPlayer with image timer and video playback"
```

---

### Task 4: Add inline duration editing on timeline blocks

**Files:**
- Modify: `veha-dashboard/src/components/playlist/TimelineBlock.tsx`

**Step 1: Add click-to-edit on the duration label**

In `TimelineBlock.tsx`, add an `[editing, setEditing]` state. When the duration text is clicked, show an `<input>` instead. On Enter or blur, commit the new value.

Add to the component:

```tsx
const [editingDuration, setEditingDuration] = useState(false)
const [draftDuration, setDraftDuration] = useState(String(durationSecs))

const commitDuration = () => {
  const val = parseInt(draftDuration)
  if (val > 0 && val !== durationSecs) onDurationChange(val)
  setEditingDuration(false)
}
```

Replace the duration `<span>` at the bottom of the block with:

```tsx
{editingDuration && isImage ? (
  <input
    autoFocus
    type="number"
    min={1}
    value={draftDuration}
    onChange={(e) => setDraftDuration(e.target.value)}
    onBlur={commitDuration}
    onKeyDown={(e) => { if (e.key === 'Enter') commitDuration() }}
    className="w-10 bg-bg-surface/80 rounded px-1 text-[10px] text-text-primary text-center outline-none border border-accent"
    onClick={(e) => e.stopPropagation()}
  />
) : (
  <span
    className={cn('text-[10px] text-text-secondary tabular-nums drop-shadow-sm', isImage && 'cursor-text hover:text-accent')}
    onClick={(e) => {
      if (isImage) {
        e.stopPropagation()
        setDraftDuration(String(durationSecs))
        setEditingDuration(true)
      }
    }}
  >
    {durationSecs}s
  </span>
)}
```

**Step 2: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors. Click the "10s" label on an image block — turns into input. Type new value, press Enter.

**Step 3: Commit**

```bash
git add veha-dashboard/src/components/playlist/TimelineBlock.tsx
git commit -m "feat(dashboard): add inline duration editing on timeline blocks"
```

---

### Task 5: Add keyboard shortcuts (Space, Delete, D, arrows)

**Files:**
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx`

**Step 1: Add global keyboard handler**

In `PlaylistEditor.tsx`, add a `useEffect` that listens for keyboard events on the page level. This handles Space (play/pause via ref), Delete/Backspace (remove selected), D (duplicate), and arrow keys (navigate).

Add a `playerRef` to pass to PreviewPlayer, and wire keyboard events:

```tsx
const playerRef = useRef<{ togglePlay: () => void } | null>(null)

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Don't capture when typing in inputs
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return

    if (e.key === ' ') {
      e.preventDefault()
      playerRef.current?.togglePlay()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIndex !== null) {
      dispatch({ type: 'REMOVE_ITEM', index: state.selectedIndex })
    } else if (e.key === 'd' && state.selectedIndex !== null) {
      dispatch({ type: 'DUPLICATE', index: state.selectedIndex })
    } else if (e.key === 'ArrowLeft' && state.selectedIndex !== null && state.selectedIndex > 0) {
      dispatch({ type: 'SELECT', index: state.selectedIndex - 1 })
    } else if (e.key === 'ArrowRight' && state.selectedIndex !== null && state.selectedIndex < state.items.length - 1) {
      dispatch({ type: 'SELECT', index: state.selectedIndex + 1 })
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [state.selectedIndex, state.items.length])
```

Expose `togglePlay` from PreviewPlayer via `useImperativeHandle` (or keep it simple and just make Space trigger a custom event — implementer's choice). The simplest approach: add a `playingRef` in PreviewPlayer and expose a togglePlay method.

**Step 2: Verify**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors. Select a block, press Delete — removed. Press D — duplicated. Arrow keys navigate. Space toggles play.

**Step 3: Commit**

```bash
git add veha-dashboard/src/pages/PlaylistEditor.tsx veha-dashboard/src/components/playlist/PreviewPlayer.tsx
git commit -m "feat(dashboard): add keyboard shortcuts for playlist editor"
```

---

### Task 6: Final polish — empty state, unsaved changes warning, cleanup

**Files:**
- Modify: `veha-dashboard/src/pages/PlaylistEditor.tsx`
- Modify: `veha-dashboard/src/pages/Playlists.tsx`

**Step 1: Add unsaved changes warning**

In `PlaylistEditor.tsx`, warn before navigating away if there are unsaved changes:

```tsx
useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    if (state.dirty) e.preventDefault()
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [state.dirty])
```

Also update the back button to confirm:

```tsx
const handleBack = () => {
  if (state.dirty && !window.confirm('You have unsaved changes. Discard?')) return
  navigate('/playlists')
}
```

**Step 2: Clean up the old edit modal code in Playlists.tsx**

Remove `openEdit`, `editItem` state, and the inline editing parts of the modal. Keep only the "New Playlist" create modal (it's still useful for quick creation). Remove unused imports (`ChevronUp`, `ChevronDown`, `X`, etc.) that were only used by the old inline editor.

**Step 3: Verify everything**

Run: `cd veha-dashboard && npx tsc --noEmit`
Expected: No errors.

Run: `cd veha-dashboard && bun run build`
Expected: Build succeeds.

Manual test:
1. Go to `/playlists` — see list with Edit buttons
2. Click Edit — navigates to `/playlists/:id/edit`
3. See toolbar with name/loop/save
4. See preview player
5. See timeline with blocks
6. Click a block — shows in preview
7. Drag blocks to reorder
8. Drag right edge of image block to resize
9. Click duration to edit inline
10. Right-click for context menu (Duplicate/Remove)
11. Press Space — toggles play
12. Press Delete — removes selected
13. Click "Play All" — sequences through playlist
14. Click Save — persists changes
15. Try to navigate away with unsaved changes — warns

**Step 4: Commit**

```bash
git add -A veha-dashboard/src/
git commit -m "feat(dashboard): complete playlist timeline editor with polish"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Page shell, route, reducer | PlaylistEditor.tsx, App.tsx, Header.tsx, Playlists.tsx |
| 2 | Timeline + draggable blocks | Timeline.tsx, TimelineBlock.tsx |
| 3 | Preview player | PreviewPlayer.tsx |
| 4 | Inline duration editing | TimelineBlock.tsx |
| 5 | Keyboard shortcuts | PlaylistEditor.tsx, PreviewPlayer.tsx |
| 6 | Polish + cleanup | PlaylistEditor.tsx, Playlists.tsx |
