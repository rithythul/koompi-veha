import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, ListVideo } from 'lucide-react'
import type { MediaItem, Media } from '../../types/api'
import { resolveIsVideo } from './playlistUtils'

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
    const [videoProgress, setVideoProgress] = useState(0)
    const [videoDuration, setVideoDuration] = useState(0)
    const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
    const sequentialRef = useRef(false)
    useEffect(() => { sequentialRef.current = sequential }, [sequential])

    const currentIndex = selectedIndex ?? 0
    const currentItem = items[currentIndex] ?? null
    const durationSecs = currentItem?.duration?.secs ?? 10
    const isVideo = resolveIsVideo(currentItem, mediaList)

    const clearTimer = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
    }

    // Reset on item change
    useEffect(() => {
      setElapsed(0)
      setVideoProgress(0)
      setVideoDuration(0)
      clearTimer()
      if (!sequentialRef.current) setPlaying(false)
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
      setPlaying((p) => !p)
    }, [playing, isVideo])

    useImperativeHandle(ref, () => ({ togglePlay }), [togglePlay])

    const playAll = () => {
      setSequential(true)
      setElapsed(0)
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

    const handleSeek = (val: number) => {
      if (isVideo && videoRef.current && videoDuration > 0) {
        videoRef.current.currentTime = val * videoDuration
        setVideoProgress(val)
      } else {
        setElapsed(Math.round(val * durationSecs))
      }
    }

    const displayProgress = isVideo
      ? videoProgress
      : durationSecs > 0 ? Math.min(elapsed / durationSecs, 1) : 0
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
            <img
              src={currentItem.source}
              alt={currentItem.name ?? ''}
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}
          {currentItem && isVideo && (
            <video
              ref={videoRef}
              src={currentItem.source}
              className="absolute inset-0 w-full h-full object-contain"
              onEnded={() => { if (sequential) advanceToNext(); else setPlaying(false) }}
              onTimeUpdate={() => {
                const v = videoRef.current
                if (v && v.duration) {
                  setVideoProgress(v.currentTime / v.duration)
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) setVideoDuration(videoRef.current.duration)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
          {/* Item counter badge */}
          <div className="absolute top-2 right-2 bg-black/60 rounded-md px-2 py-0.5 text-[11px] text-white/80 tabular-nums pointer-events-none">
            {currentIndex + 1} / {items.length}
          </div>
          {/* Item name badge */}
          {currentItem?.name && (
            <div className="absolute bottom-2 left-2 bg-black/60 rounded-md px-2 py-0.5 text-[11px] text-white/80 max-w-[60%] truncate pointer-events-none">
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
            className="w-full accent-accent cursor-pointer"
            style={{ height: '4px' }}
          />
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button
            onClick={goPrev}
            disabled={currentIndex <= 0}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 rounded-full bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={goNext}
            disabled={currentIndex >= items.length - 1}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer"
          >
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
