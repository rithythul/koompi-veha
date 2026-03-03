import { useState } from 'react'
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
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted py-10">
            <Film className="w-8 h-8 opacity-30" />
            <p className="text-sm">No items yet</p>
            <button
              onClick={onAddMedia}
              className="text-sm text-accent hover:text-accent-hover cursor-pointer"
            >
              Add media →
            </button>
          </div>
        ) : (
          items.map((item, i) => (
            <PlaylistItemRow
              key={item.source + i}
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
  item,
  index,
  selected,
  isDragging,
  isDropTarget,
  mediaList,
  onSelect,
  onRemove,
  // onDuplicate intentionally not destructured
  onDurationChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
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
        selected
          ? 'bg-accent/10 border-l-accent'
          : 'border-l-transparent hover:bg-bg-elevated',
        isDragging && 'opacity-40',
        isDropTarget && 'border-t border-t-accent',
      )}
    >
      {/* Drag handle */}
      <div className="text-text-muted/40 group-hover:text-text-muted cursor-grab active:cursor-grabbing flex-shrink-0">
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
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDur()
            e.stopPropagation()
          }}
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
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="p-1 text-transparent group-hover:text-text-muted hover:!text-status-error transition-colors cursor-pointer flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
