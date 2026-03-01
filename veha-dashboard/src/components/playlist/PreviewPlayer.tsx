import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import type { MediaItem } from '../../types/api'

export interface PreviewPlayerHandle {
  togglePlay: () => void
}

interface PreviewPlayerProps {
  items: MediaItem[]
  selectedIndex: number | null
  onIndexChange: (index: number) => void
}

export const PreviewPlayer = forwardRef<PreviewPlayerHandle, PreviewPlayerProps>(
  function PreviewPlayer({ items, selectedIndex, onIndexChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [playing, setPlaying] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [sequential, setSequential] = useState(false)
    const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

    const currentIndex = selectedIndex ?? 0
    const currentItem = items[currentIndex] ?? null
    const durationSecs = currentItem?.duration?.secs ?? 10
    const isVideo = currentItem ? /\.(mp4|webm)$/i.test(currentItem.source) : false

    const clearTimer = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
    }

    // Reset on item change
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

    // Image countdown timer
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

    const playAll = () => {
      setSequential(true)
      onIndexChange(0)
      setPlaying(true)
    }

    const stopAll = () => {
      setSequential(false)
      setPlaying(false)
      if (isVideo && videoRef.current) videoRef.current.pause()
    }

    const goPrev = () => { if (currentIndex > 0) onIndexChange(currentIndex - 1) }
    const goNext = () => { if (currentIndex < items.length - 1) onIndexChange(currentIndex + 1) }

    if (items.length === 0) {
      return (
        <div className="flex items-center justify-center h-48 bg-bg-surface border border-border-default rounded-lg flex-shrink-0">
          <p className="text-text-muted text-sm">Add media to preview</p>
        </div>
      )
    }

    return (
      <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden flex-shrink-0">
        {/* Media display */}
        <div className="flex items-center justify-center h-48 bg-black/20">
          {currentItem && !isVideo && (
            <img src={currentItem.source} alt={currentItem.name ?? ''} className="max-h-full max-w-full object-contain" />
          )}
          {currentItem && isVideo && (
            <video
              ref={videoRef}
              src={currentItem.source}
              className="max-h-full max-w-full object-contain"
              onEnded={() => { if (sequential) advanceToNext(); else setPlaying(false) }}
              onTimeUpdate={() => { if (videoRef.current) setElapsed(Math.floor(videoRef.current.currentTime)) }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
        </div>

        {/* Transport controls */}
        <div className="flex items-center justify-center gap-3 py-2 px-4 border-t border-border-default">
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
            {elapsed}s / {durationSecs}s
          </span>
          <span className="text-xs text-text-muted ml-2">
            ({currentIndex + 1} / {items.length})
          </span>
          {!sequential ? (
            <button onClick={playAll} className="ml-auto text-xs text-accent hover:text-accent-hover cursor-pointer">
              Play All
            </button>
          ) : (
            <button onClick={stopAll} className="ml-auto text-xs text-status-error hover:text-status-error/80 cursor-pointer">
              Stop
            </button>
          )}
        </div>
      </div>
    )
  },
)
