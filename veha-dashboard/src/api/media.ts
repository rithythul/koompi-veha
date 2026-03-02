import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, ApiError } from './client'
import { toQueryString } from '../lib/utils'
import type { Media, PaginatedResponse } from '../types/api'

export function useMedia(params?: { page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['media', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Media>>(
        `/api/media?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

/** Upload a file with progress reporting via XMLHttpRequest. */
export function uploadMediaWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<Media> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media')
    xhr.withCredentials = true

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'))
        reject(new ApiError(401, 'Authentication required'))
      } else if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          resolve(null as unknown as Media)
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || `HTTP ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error'))

    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

export function useUploadMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiClient<Media>('/api/media', { method: 'POST', body: form })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

export function useRenameMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient<Media>(`/api/media/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/media/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

export function mediaDownloadUrl(id: string): string {
  return `/api/media/${id}/download`
}

export function mediaThumbnailUrl(id: string): string {
  return `/api/media/${id}/thumbnail`
}
