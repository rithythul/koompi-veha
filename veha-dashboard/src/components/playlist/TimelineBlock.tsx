import { useRef, useState } from 'react'
import { Film, Image as ImageIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MediaItem, Media } from '../../types/api'
import { resolveIsVideo, resolveMediaId } from './playlistUtils'
import { mediaThumbnailUrl } from '../../api/media'

interface TimelineBlockProps {
  item: MediaItem
  index: number
  selected: boolean
  pixelsPerSecond: number
  mediaList?: Media[]
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
  mediaList,
  onSelect,
  onDurationChange,
  onDragStart,
  onContextMenu,
}: TimelineBlockProps) {
  const durationSecs = item.duration?.secs ?? 10
  const width = Math.max(durationSecs * pixelsPerSecond, 48)
  const isVideo = resolveIsVideo(item, mediaList)
  const isImage = !isVideo
  const mediaId = resolveMediaId(item.source)

  // Inline duration editing
  const [editingDuration, setEditingDuration] = useState(false)
  const [draftDuration, setDraftDuration] = useState(String(durationSecs))

  const commitDuration = () => {
    const val = parseInt(draftDuration)
    if (val > 0 && val !== durationSecs) onDurationChange(val)
    setEditingDuration(false)
  }

  // Resize handle state
  const [resizing, setResizing] = useState(false)
  const startXRef = useRef(0)
  const startDurRef = useRef(durationSecs)

  const handleResizeStart = (e: React.PointerEvent) => {
    if (!isImage) return
    e.stopPropagation()
    e.preventDefault()
    setResizing(true)
    startXRef.current = e.clientX
    startDurRef.current = durationSecs
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizing) return
    const dx = e.clientX - startXRef.current
    const newSecs = Math.max(1, Math.round(startDurRef.current + dx / pixelsPerSecond))
    onDurationChange(newSecs)
  }

  const handleResizeEnd = () => setResizing(false)

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

        {/* Duration — click to edit (images only) */}
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
            className={cn(
              'text-[10px] text-text-secondary tabular-nums drop-shadow-sm',
              isImage && 'cursor-text hover:text-accent',
            )}
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
      </div>

      {/* Resize handle (images only) */}
      {isImage && (
        <div
          className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-accent/30 transition-colors z-20"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}
    </div>
  )
}
