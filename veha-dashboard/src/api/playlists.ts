import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { PlaylistResponse, CreatePlaylist, PaginatedResponse } from '../types/api'

export function usePlaylists(params?: { page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['playlists', params],
    queryFn: () =>
      apiClient<PaginatedResponse<PlaylistResponse>>(
        `/api/playlists?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ['playlists', id],
    queryFn: () => apiClient<PlaylistResponse>(`/api/playlists/${id}`),
    enabled: !!id,
  })
}

export function useCreatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePlaylist) =>
      apiClient<PlaylistResponse>('/api/playlists', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  })
}

export function useUpdatePlaylist(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePlaylist) =>
      apiClient<PlaylistResponse>(`/api/playlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      qc.invalidateQueries({ queryKey: ['playlists', id] })
    },
  })
}

export function useDeletePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/playlists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  })
}
