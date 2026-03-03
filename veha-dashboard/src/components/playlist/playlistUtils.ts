import type { MediaItem, Media } from '../../types/api'

export function resolveIsVideo(item: MediaItem | null, mediaList?: Media[]): boolean {
  if (!item) return false
  if (mediaList) {
    const match = item.source.match(/\/api\/media\/([^/]+)\/download/)
    if (match) {
      const media = mediaList.find((m) => m.id === match[1])
      if (media) return media.mime_type.startsWith('video/')
    }
  }
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(item.source) ||
         /\.(mp4|webm|mov|avi|mkv)$/i.test(item.name ?? '')
}

export function resolveMediaId(source: string): string | null {
  const match = source.match(/\/api\/media\/([^/]+)\/download/)
  return match ? match[1] : null
}
