import { useRef, useState, useCallback } from 'react'
import { Plus, ZoomIn, ZoomOut } from 'lucide-react'
import { TimelineBlock } from './TimelineBlock'
import { cn } from '../../lib/utils'
import type { MediaItem, Media } from '../../types/api'

interface TimelineProps {
  items: MediaItem[]
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  onReorder: (from: number, to: number) => void
  onDurationChange: (index: number, secs: number) => void
  onRemove: (index: number) => void
  onDuplicate: (index: number) => void
  onAddMedia: () => void
  mediaList?: Media[]
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
  mediaList,
}: TimelineProps) {
  const [zoom, setZoom] = useState(8)
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

  return (
    <div
      className="flex flex-col h-full bg-bg-surface border border-border-default rounded-lg overflow-hidden"
      onClick={(e) => {
        if (contextMenu) closeContextMenu()
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
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <button
              onClick={onAddMedia}
              className="flex flex-col items-center gap-2 text-text-muted hover:text-accent transition-colors cursor-pointer"
            >
              <Plus className="w-8 h-8" />
              <span className="text-sm">Add media to get started</span>
            </button>
          </div>
        ) : (
          <div ref={trackRef} className="flex items-stretch gap-1 h-20">
            {items.map((item, i) => (
              <div key={i} className="relative">
                {dragIndex !== null && dropIndex === i && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent -translate-x-1 z-20" />
                )}
                <TimelineBlock
                  item={item}
                  index={i}
                  selected={selectedIndex === i}
                  pixelsPerSecond={zoom}
                  mediaList={mediaList}
                  onSelect={() => onSelect(i)}
                  onDurationChange={(secs) => onDurationChange(i, secs)}
                  onDragStart={handleDragStart}
                  onContextMenu={handleContextMenu}
                />
              </div>
            ))}
            {dragIndex !== null && dropIndex === items.length && (
              <div className="w-0.5 bg-accent self-stretch" />
            )}

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
        )}
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
              onClick={() => { onDuplicate(contextMenu.index); closeContextMenu() }}
            >
              Duplicate
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-status-error hover:bg-bg-elevated cursor-pointer"
              onClick={() => { onRemove(contextMenu.index); closeContextMenu() }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
}
