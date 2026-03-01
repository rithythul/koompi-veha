import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { Advertiser, CreateAdvertiser, PaginatedResponse } from '../types/api'

export function useAdvertisers(params?: { page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['advertisers', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Advertiser>>(
        `/api/advertisers?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useAdvertiser(id: string) {
  return useQuery({
    queryKey: ['advertisers', id],
    queryFn: () => apiClient<Advertiser>(`/api/advertisers/${id}`),
    enabled: !!id,
  })
}

export function useCreateAdvertiser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAdvertiser) =>
      apiClient<Advertiser>('/api/advertisers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['advertisers'] }),
  })
}

export function useUpdateAdvertiser(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAdvertiser) =>
      apiClient<Advertiser>(`/api/advertisers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advertisers'] })
      qc.invalidateQueries({ queryKey: ['advertisers', id] })
    },
  })
}

export function useDeleteAdvertiser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/advertisers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['advertisers'] }),
  })
}
