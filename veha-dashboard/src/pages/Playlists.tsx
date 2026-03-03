import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListVideo, Plus, Pencil, Trash2, RotateCcw, Clock } from 'lucide-react'
import { usePlaylists, useCreatePlaylist, useDeletePlaylist } from '../api/playlists'
import { useMedia, mediaDownloadUrl, mediaThumbnailUrl } from '../api/media'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { cn, formatDate } from '../lib/utils'
import { resolveMediaId } from '../components/playlist/playlistUtils'
import type { Media, PlaylistResponse } from '../types/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function totalDuration(pl: PlaylistResponse): string {
  const secs = pl.items.reduce((acc, item) => acc + (item.duration?.secs ?? 10), 0)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function ThumbImg({ source, mediaList, className }: { source: string; mediaList: Media[]; className?: string }) {
  const mediaId = resolveMediaId(source)
  const media = mediaId ? mediaList.find((m) => m.id === mediaId) : null
  const isVideo = media?.mime_type.startsWith('video/')
  const src = mediaId ? (isVideo ? mediaThumbnailUrl(mediaId) : mediaDownloadUrl(mediaId)) : null

  if (!src) return <div className={cn('bg-bg-elevated', className)} />

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn('object-cover', className)}
      onError={(e) => { e.currentTarget.style.display = 'none' }}
    />
  )
}

// Horizontal filmstrip: 4 sequential cells showing the ordered media items
function PlaylistFilmstrip({ pl, mediaList }: { pl: PlaylistResponse; mediaList: Media[] }) {
  const SLOTS = 4
  return (
    <div className="flex gap-px w-[160px] h-[36px] flex-shrink-0 rounded-md overflow-hidden bg-bg-elevated border border-border-default">
      {Array.from({ length: SLOTS }).map((_, i) => {
        const item = pl.items[i]
        if (!item) {
          return (
            <div
              key={i}
              className={cn('flex-1 bg-bg-elevated', i > 0 && 'border-l border-border-default/50')}
            />
          )
        }
        return (
          <div key={i} className={cn('flex-1 relative overflow-hidden', i > 0 && 'border-l border-border-default/50')}>
            <ThumbImg source={item.source} mediaList={mediaList} className="w-full h-full" />
          </div>
        )
      })}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PlaylistRow({
  pl,
  mediaList,
  onEdit,
  onDelete,
}: {
  pl: PlaylistResponse
  mediaList: Media[]
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onEdit}
      className="group flex items-center gap-4 px-4 py-3 border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors cursor-pointer"
    >
      {/* Filmstrip */}
      <PlaylistFilmstrip pl={pl} mediaList={mediaList} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text-primary truncate">{pl.name}</p>
          {pl.loop_playlist && (
            <span title="Loops">
              <RotateCcw className="w-3 h-3 text-text-muted flex-shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-text-muted">
            {pl.items.length} {pl.items.length === 1 ? 'item' : 'items'}
          </span>
          {pl.items.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Clock className="w-3 h-3" />
              {totalDuration(pl)}
            </span>
          )}
        </div>
      </div>

      {/* Date */}
      <span className="text-xs text-text-muted hidden sm:block flex-shrink-0 w-24 text-right">
        {formatDate(pl.updated_at)}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="p-1.5 rounded hover:bg-bg-surface text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1.5 rounded hover:bg-bg-surface text-text-muted hover:text-status-error transition-colors cursor-pointer"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Playlists() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const { data, isLoading } = usePlaylists({ page, per_page: 48 })
  const { data: mediaData } = useMedia({ per_page: 200 })
  const [showForm, setShowForm] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formLoop, setFormLoop] = useState(false)

  const createPlaylist = useCreatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const playlists = data?.data ?? []
  const mediaList = mediaData?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 48))

  const openCreate = () => {
    setFormName('')
    setFormLoop(false)
    setShowForm(true)
  }

  const handleCreate = async () => {
    try {
      const created = await createPlaylist.mutateAsync({ name: formName, items: [], loop_playlist: formLoop })
      toast.success('Playlist created')
      setShowForm(false)
      navigate(`/playlists/${created.id}/edit`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deletePlaylist.mutateAsync(deleteId)
      toast.success('Playlist deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Playlists</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New Playlist
        </Button>
      </div>

      {playlists.length === 0 ? (
        <EmptyState
          icon={ListVideo}
          title="No playlists"
          description="Create playlists to organize media for your boards."
          action={{ label: 'New Playlist', onClick: openCreate }}
        />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-xl overflow-hidden">
          {/* Column header */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border-default bg-bg-primary">
            <div className="w-[160px] flex-shrink-0 text-[11px] font-medium text-text-muted uppercase tracking-wider">
              Sequence
            </div>
            <div className="flex-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">Name</div>
            <div className="hidden sm:block w-24 text-right text-[11px] font-medium text-text-muted uppercase tracking-wider">
              Updated
            </div>
            <div className="w-16 flex-shrink-0" />
          </div>

          {playlists.map((pl) => (
            <PlaylistRow
              key={pl.id}
              pl={pl}
              mediaList={mediaList}
              onEdit={() => navigate(`/playlists/${pl.id}/edit`)}
              onDelete={() => setDeleteId(pl.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex justify-center">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* New Playlist Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Playlist"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              loading={createPlaylist.isPending}
              disabled={!formName.trim()}
            >
              Create & Edit
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="My Playlist"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && formName.trim()) handleCreate() }}
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formLoop}
              onChange={(e) => setFormLoop(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-sm text-text-secondary">Loop playlist</span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Playlist"
        message="Schedules using this playlist will also be deleted."
        loading={deletePlaylist.isPending}
      />
    </div>
  )
}
