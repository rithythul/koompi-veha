import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListVideo, Plus, Pencil, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react'
import { usePlaylists, useCreatePlaylist, useUpdatePlaylist, useDeletePlaylist } from '../api/playlists'
import { useMedia, mediaDownloadUrl } from '../api/media'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import type { PlaylistResponse, MediaItem, CreatePlaylist } from '../types/api'

export default function Playlists() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const { data, isLoading } = usePlaylists({ page, per_page: 50 })
  const { data: mediaData } = useMedia({ per_page: 200 })
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<PlaylistResponse | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showMediaPicker, setShowMediaPicker] = useState(false)

  const [formName, setFormName] = useState('')
  const [formLoop, setFormLoop] = useState(false)
  const [formItems, setFormItems] = useState<MediaItem[]>([])

  const createPlaylist = useCreatePlaylist()
  const updatePlaylist = useUpdatePlaylist(editItem?.id ?? '')
  const deletePlaylist = useDeletePlaylist()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const playlists = data?.data ?? []
  const mediaList = mediaData?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const openCreate = () => {
    setEditItem(null)
    setFormName('')
    setFormLoop(false)
    setFormItems([])
    setShowForm(true)
  }

  const openEdit = (pl: PlaylistResponse) => {
    setEditItem(pl)
    setFormName(pl.name)
    setFormLoop(pl.loop_playlist)
    setFormItems([...pl.items])
    setShowForm(true)
  }

  const handleSave = () => {
    const payload: CreatePlaylist = { name: formName, items: formItems, loop_playlist: formLoop }
    const mutation = editItem ? updatePlaylist : createPlaylist
    mutation.mutate(payload, {
      onSuccess: () => {
        toast.success(editItem ? 'Playlist updated' : 'Playlist created')
        setShowForm(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = () => {
    if (!deleteId) return
    deletePlaylist.mutate(deleteId, {
      onSuccess: () => {
        toast.success('Playlist deleted')
        setDeleteId(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const addMediaItem = (mediaId: string) => {
    const media = mediaList.find((m) => m.id === mediaId)
    if (!media) return
    setFormItems([
      ...formItems,
      { source: mediaDownloadUrl(mediaId), name: media.name, duration: { secs: 10, nanos: 0 } },
    ])
    setShowMediaPicker(false)
  }

  const removeItem = (index: number) => {
    setFormItems(formItems.filter((_, i) => i !== index))
  }

  const moveItem = (index: number, dir: -1 | 1) => {
    const newItems = [...formItems]
    const target = index + dir
    if (target < 0 || target >= newItems.length) return
    ;[newItems[index], newItems[target]] = [newItems[target], newItems[index]]
    setFormItems(newItems)
  }

  const updateItemDuration = (index: number, secs: number) => {
    const newItems = [...formItems]
    newItems[index] = { ...newItems[index], duration: { secs, nanos: 0 } }
    setFormItems(newItems)
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
        <div className="space-y-3">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className="bg-bg-surface border border-border-default rounded-lg px-4 py-3 flex items-center justify-between hover:bg-bg-elevated transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-text-primary">{pl.name}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {pl.items.length} items &middot; {pl.loop_playlist ? 'Loop' : 'Once'} &middot; {formatDate(pl.updated_at)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/playlists/${pl.id}/edit`)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(pl.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-status-error" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Playlist Editor Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editItem ? 'Edit Playlist' : 'New Playlist'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={createPlaylist.isPending || updatePlaylist.isPending} disabled={!formName.trim()}>
              {editItem ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="My Playlist" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formLoop}
                  onChange={(e) => setFormLoop(e.target.checked)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-secondary">Loop</span>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-secondary">Media Items</label>
              <Button variant="secondary" size="sm" onClick={() => setShowMediaPicker(true)}>
                <Plus className="w-3.5 h-3.5" /> Add Media
              </Button>
            </div>

            {formItems.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-6 bg-bg-primary rounded-lg border border-border-default">
                No items. Click "Add Media" to add content.
              </p>
            ) : (
              <div className="space-y-1">
                {formItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 bg-bg-primary rounded-md border border-border-default"
                  >
                    <span className="text-text-muted text-xs w-5 text-right">{i + 1}</span>
                    <span className="text-sm text-text-primary flex-1 truncate">{item.name ?? 'Untitled'}</span>
                    <input
                      type="number"
                      min={1}
                      value={item.duration?.secs ?? 10}
                      onChange={(e) => updateItemDuration(i, parseInt(e.target.value) || 10)}
                      className="w-16 bg-bg-surface border border-border-default rounded px-2 py-1 text-xs text-text-primary text-center"
                    />
                    <span className="text-text-muted text-xs">sec</span>
                    <button onClick={() => moveItem(i, -1)} disabled={i === 0} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => moveItem(i, 1)} disabled={i === formItems.length - 1} className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeItem(i)} className="p-0.5 text-status-error hover:text-status-error/80 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Media Picker Modal */}
      <Modal
        open={showMediaPicker}
        onClose={() => setShowMediaPicker(false)}
        title="Select Media"
      >
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {mediaList.map((media) => (
            <button
              key={media.id}
              onClick={() => addMediaItem(media.id)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-bg-elevated transition-colors text-left cursor-pointer"
            >
              <span className="text-sm text-text-primary">{media.name}</span>
              <span className="text-xs text-text-muted ml-auto">{media.mime_type.split('/')[1]}</span>
            </button>
          ))}
          {mediaList.length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">No media uploaded yet.</p>
          )}
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
