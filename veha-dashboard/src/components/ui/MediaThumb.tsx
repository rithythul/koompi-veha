import { Film, Image } from 'lucide-react'
import { mediaDownloadUrl, mediaThumbnailUrl } from '../../api/media'

interface MediaThumbProps {
  mediaId: string
  mimeType?: string
  name?: string
  size?: 'sm' | 'md'
}

/**
 * Reusable media thumbnail component. Shows image preview for images,
 * ffmpeg-generated thumbnail for videos, and a fallback icon for others.
 */
export function MediaThumb({ mediaId, mimeType, name, size = 'sm' }: MediaThumbProps) {
  const dims = size === 'sm' ? 'w-10 h-10' : 'w-16 h-10'
  const isImage = mimeType?.startsWith('image/')
  const isVideo = mimeType?.startsWith('video/')

  if (isImage) {
    return (
      <img
        src={mediaDownloadUrl(mediaId)}
        alt={name ?? ''}
        className={`${dims} rounded object-cover flex-shrink-0 bg-bg-elevated`}
        loading="lazy"
      />
    )
  }

  if (isVideo) {
    return (
      <div className={`${dims} rounded bg-bg-elevated flex-shrink-0 relative overflow-hidden`}>
        <img
          src={mediaThumbnailUrl(mediaId)}
          alt={name ?? ''}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            e.currentTarget.nextElementSibling?.classList.remove('hidden')
          }}
        />
        <div className="hidden absolute inset-0 flex items-center justify-center">
          <Film className="w-4 h-4 text-text-muted" />
        </div>
        <div className="absolute bottom-0 right-0 bg-black/70 rounded-tl px-1">
          <Film className="w-2.5 h-2.5 text-white/80" />
        </div>
      </div>
    )
  }

  // Fallback for unknown types
  return (
    <div className={`${dims} rounded bg-bg-elevated flex-shrink-0 flex items-center justify-center`}>
      <Image className="w-4 h-4 text-text-muted" />
    </div>
  )
}
