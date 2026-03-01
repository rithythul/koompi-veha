import { useState, useCallback, useRef } from 'react'
import { Image, Trash2, Download, Eye, Film, Upload, LayoutGrid, List } from 'lucide-react'
import { useMedia, useDeleteMedia, mediaDownloadUrl, uploadMediaWithProgress } from '../api/media'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { DropZone } from '../components/ui/DropZone'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatBytes, formatDate } from '../lib/utils'

export default function MediaLibrary() {
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const { data, isLoading } = useMedia({ page, per_page: 24 })
  const deleteMedia = useDeleteMedia()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback((files: File[]) => {
    for (const file of files) {
      const entry = { name: file.name, progress: 0 }
      setUploads((prev) => [...prev, entry])
      uploadMediaWithProgress(file, (percent) => {
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, progress: percent } : u)),
        )
      })
        .then(() => {
          toast.success(`Uploaded ${file.name}`)
          queryClient.invalidateQueries({ queryKey: ['media'] })
        })
        .catch((err: Error) => toast.error(`Failed: ${err.message}`))
        .finally(() => {
          setUploads((prev) => prev.filter((u) => u.name !== file.name))
        })
    }
  }, [queryClient, toast])

  if (isLoading) return <PageSpinner />

  const items = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / 24)
  const previewItem = items.find((m) => m.id === previewId)

  const handleDelete = () => {
    if (!deleteId) return
    deleteMedia.mutate(deleteId, {
      onSuccess: () => {
        toast.success('Media deleted')
        setDeleteId(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const isVideo = (mime: string) => mime.startsWith('video/')
  const isImage = (mime: string) => mime.startsWith('image/')

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Media Library</h1>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <div className="flex items-center bg-bg-surface border border-border-default rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
                }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          )}
          {items.length > 0 && (
            <>
              <Button onClick={() => fileInputRef.current?.click()} size="sm">
                <Upload className="w-4 h-4" /> Upload
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || [])
                  if (files.length > 0) handleUpload(files)
                  e.target.value = ''
                }}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="mb-4 space-y-2">
          {uploads.map((u) => (
            <div key={u.name} className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-lg">
              <div className="flex items-center justify-between text-sm text-accent mb-1">
                <span className="truncate">{u.name}</span>
                <span className="tabular-nums">{u.progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-[width] duration-200"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div>
          <DropZone
            onFiles={handleUpload}
            accept="image/*,video/*"
            className="mb-6"
          />
          <EmptyState
            icon={Image}
            title="No media files"
            description="Upload images and videos to use in playlists and campaigns."
          />
        </div>
      ) : viewMode === 'list' ? (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Preview</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {items.map((media) => (
                <tr key={media.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-2">
                    <div className="w-16 h-10 rounded bg-bg-primary flex items-center justify-center overflow-hidden">
                      {isImage(media.mime_type) ? (
                        <img src={mediaDownloadUrl(media.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <Film className="w-5 h-5 text-text-muted" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-text-primary font-medium">{media.name}</td>
                  <td className="px-4 py-2 text-text-secondary text-xs uppercase">{media.mime_type.split('/')[1]}</td>
                  <td className="px-4 py-2 text-text-secondary tabular-nums">{formatBytes(media.size)}</td>
                  <td className="px-4 py-2 text-text-muted text-xs">{formatDate(media.uploaded_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setPreviewId(media.id)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <a
                        href={mediaDownloadUrl(media.id)}
                        download
                        className="inline-flex items-center justify-center p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(media.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-status-error" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((media) => (
            <div
              key={media.id}
              className="bg-bg-surface border border-border-default rounded-lg overflow-hidden group"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-bg-primary flex items-center justify-center">
                {isImage(media.mime_type) ? (
                  <img
                    src={mediaDownloadUrl(media.id)}
                    alt={media.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Film className="w-10 h-10 text-text-muted" />
                )}
                {/* Overlay actions */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPreviewId(media.id)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  <a
                    href={mediaDownloadUrl(media.id)}
                    download
                    className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-medium rounded-lg bg-bg-elevated hover:bg-border-hover text-text-primary border border-border-default transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <Button variant="danger" size="sm" onClick={() => setDeleteId(media.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {/* Info */}
              <div className="px-3 py-2.5">
                <p className="text-sm text-text-primary font-medium truncate">{media.name}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {media.mime_type.split('/')[1]?.toUpperCase()} &middot; {formatBytes(media.size)}
                </p>
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

      {/* Preview Modal */}
      <Modal
        open={!!previewId}
        onClose={() => setPreviewId(null)}
        title={previewItem?.name ?? 'Preview'}
        size="lg"
      >
        {previewItem && (
          <div>
            {isImage(previewItem.mime_type) ? (
              <img
                src={mediaDownloadUrl(previewItem.id)}
                alt={previewItem.name}
                className="w-full rounded-lg"
              />
            ) : isVideo(previewItem.mime_type) ? (
              <video
                src={mediaDownloadUrl(previewItem.id)}
                controls
                className="w-full rounded-lg"
              />
            ) : (
              <p className="text-text-muted">Preview not available for this file type.</p>
            )}
            <div className="mt-3 text-sm text-text-secondary">
              {previewItem.mime_type} &middot; {formatBytes(previewItem.size)}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Media"
        message="This will permanently delete this file. Playlists using it may break."
        loading={deleteMedia.isPending}
      />
    </div>
  )
}
