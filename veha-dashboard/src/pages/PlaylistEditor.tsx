import { useReducer, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Film } from 'lucide-react'
import { usePlaylist, useUpdatePlaylist } from '../api/playlists'
import { useMedia, mediaDownloadUrl } from '../api/media'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { PreviewPlayer } from '../components/playlist/PreviewPlayer'
import type { PreviewPlayerHandle } from '../components/playlist/PreviewPlayer'
import { Timeline } from '../components/playlist/Timeline'
import type { MediaItem } from '../types/api'

// ---------- State & Actions ----------

interface EditorState {
  name: string
  loop: boolean
  items: MediaItem[]
  selectedIndex: number | null
  dirty: boolean
}

type EditorAction =
  | { type: 'INIT'; name: string; loop: boolean; items: MediaItem[] }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_LOOP'; loop: boolean }
  | { type: 'SET_ITEMS'; items: MediaItem[] }
  | { type: 'ADD_ITEM'; item: MediaItem }
  | { type: 'REMOVE_ITEM'; index: number }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }
  | { type: 'SET_DURATION'; index: number; secs: number }
  | { type: 'DUPLICATE'; index: number }
  | { type: 'SELECT'; index: number | null }

const initialState: EditorState = {
  name: '',
  loop: false,
  items: [],
  selectedIndex: null,
  dirty: false,
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'INIT':
      return {
        name: action.name,
        loop: action.loop,
        items: action.items,
        selectedIndex: null,
        dirty: false,
      }

    case 'SET_NAME':
      return { ...state, name: action.name, dirty: true }

    case 'SET_LOOP':
      return { ...state, loop: action.loop, dirty: true }

    case 'SET_ITEMS':
      return { ...state, items: action.items, dirty: true }

    case 'ADD_ITEM':
      return {
        ...state,
        items: [...state.items, action.item],
        selectedIndex: state.items.length,
        dirty: true,
      }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter((_, i) => i !== action.index)
      let newSelected = state.selectedIndex
      if (newSelected !== null) {
        if (newSelected === action.index) {
          newSelected = null
        } else if (newSelected > action.index) {
          newSelected = newSelected - 1
        }
      }
      return { ...state, items: newItems, selectedIndex: newSelected, dirty: true }
    }

    case 'REORDER': {
      const items = [...state.items]
      const { fromIndex, toIndex } = action
      if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
        return state
      }
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      let newSelected = state.selectedIndex
      if (newSelected === fromIndex) {
        newSelected = toIndex
      } else if (newSelected !== null) {
        if (fromIndex < newSelected && toIndex >= newSelected) {
          newSelected = newSelected - 1
        } else if (fromIndex > newSelected && toIndex <= newSelected) {
          newSelected = newSelected + 1
        }
      }
      return { ...state, items, selectedIndex: newSelected, dirty: true }
    }

    case 'SET_DURATION': {
      const items = [...state.items]
      items[action.index] = {
        ...items[action.index],
        duration: { secs: action.secs, nanos: 0 },
      }
      return { ...state, items, dirty: true }
    }

    case 'DUPLICATE': {
      const items = [...state.items]
      const duplicated = { ...items[action.index] }
      items.splice(action.index + 1, 0, duplicated)
      return { ...state, items, selectedIndex: action.index + 1, dirty: true }
    }

    case 'SELECT':
      return { ...state, selectedIndex: action.index }

    default:
      return state
  }
}

// ---------- Component ----------

export default function PlaylistEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const playerRef = useRef<PreviewPlayerHandle>(null)
  const [showMediaPicker, setShowMediaPicker] = useState(false)

  const { data: playlist, isLoading } = usePlaylist(id ?? '')
  const updatePlaylist = useUpdatePlaylist(id ?? '')
  const { data: mediaData } = useMedia({ per_page: 200 })
  const mediaList = mediaData?.data ?? []

  const [state, dispatch] = useReducer(editorReducer, initialState)

  // Initialize state when playlist data arrives
  useEffect(() => {
    if (playlist) {
      dispatch({
        type: 'INIT',
        name: playlist.name,
        loop: playlist.loop_playlist,
        items: playlist.items.map((item) => ({ ...item })),
      })
    }
  }, [playlist])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

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

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state.dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [state.dirty])

  const handleBack = () => {
    if (state.dirty && !window.confirm('You have unsaved changes. Discard?')) return
    navigate('/playlists')
  }

  const handleSave = () => {
    updatePlaylist.mutate(
      {
        name: state.name,
        items: state.items,
        loop_playlist: state.loop,
      },
      {
        onSuccess: () => {
          toast.success('Playlist saved')
          dispatch({
            type: 'INIT',
            name: state.name,
            loop: state.loop,
            items: state.items,
          })
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const addMediaItem = (mediaId: string) => {
    const media = mediaList.find((m) => m.id === mediaId)
    if (!media) return
    dispatch({
      type: 'ADD_ITEM',
      item: {
        source: mediaDownloadUrl(mediaId),
        name: media.name,
        duration: { secs: 10, nanos: 0 },
      },
    })
    setShowMediaPicker(false)
  }

  if (isLoading) return <PageSpinner />

  if (!playlist) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-text-muted text-sm">Playlist not found</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/playlists')}>
          <ArrowLeft className="w-4 h-4" /> Back to Playlists
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-4 flex-shrink-0">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex-1">
          <input
            type="text"
            value={state.name}
            onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
            className="bg-transparent text-lg font-semibold text-text-primary border-none outline-none w-full placeholder:text-text-muted focus:ring-0"
            placeholder="Playlist name"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(e) => dispatch({ type: 'SET_LOOP', loop: e.target.checked })}
            className="accent-accent"
          />
          <span className="text-sm text-text-secondary">Loop</span>
        </label>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={!state.dirty || !state.name.trim()}
          loading={updatePlaylist.isPending}
        >
          <Save className="w-4 h-4" /> Save
        </Button>
      </div>

      {/* Main content area */}
      <div className="flex flex-col flex-1 gap-4 min-h-0">
        {/* Preview Player */}
        <PreviewPlayer
          ref={playerRef}
          items={state.items}
          selectedIndex={state.selectedIndex}
          onIndexChange={(i) => dispatch({ type: 'SELECT', index: i })}
        />

        {/* Timeline */}
        <div className="flex-1 min-h-[120px]">
          <Timeline
            items={state.items}
            selectedIndex={state.selectedIndex}
            onSelect={(i) => dispatch({ type: 'SELECT', index: i })}
            onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
            onDurationChange={(i, secs) => dispatch({ type: 'SET_DURATION', index: i, secs })}
            onRemove={(i) => dispatch({ type: 'REMOVE_ITEM', index: i })}
            onDuplicate={(i) => dispatch({ type: 'DUPLICATE', index: i })}
            onAddMedia={() => setShowMediaPicker(true)}
          />
        </div>
      </div>

      {/* Media Picker Modal */}
      <Modal open={showMediaPicker} onClose={() => setShowMediaPicker(false)} title="Add Media">
        {mediaList.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No media uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
            {mediaList.map((media) => (
              <button
                key={media.id}
                onClick={() => addMediaItem(media.id)}
                className="rounded-lg border border-border-default hover:border-accent overflow-hidden transition-colors cursor-pointer"
              >
                {media.mime_type.startsWith('image/') ? (
                  <img
                    src={mediaDownloadUrl(media.id)}
                    alt={media.name}
                    className="aspect-video object-cover w-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-video bg-bg-elevated flex items-center justify-center">
                    <Film className="w-6 h-6 text-text-muted" />
                  </div>
                )}
                <p className="text-[10px] text-text-primary truncate px-2 py-1">{media.name}</p>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
