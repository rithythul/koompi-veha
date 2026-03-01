import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { Zone, ZoneDetail, CreateZone } from '../types/api'

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => apiClient<Zone[]>('/api/zones'),
  })
}

export function useZone(id: string) {
  return useQuery({
    queryKey: ['zones', id],
    queryFn: () => apiClient<ZoneDetail>(`/api/zones/${id}`),
    enabled: !!id,
  })
}

export function useCreateZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateZone) =>
      apiClient<Zone>('/api/zones', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }),
  })
}

export function useUpdateZone(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateZone) =>
      apiClient<Zone>(`/api/zones/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] })
      qc.invalidateQueries({ queryKey: ['zones', id] })
    },
  })
}

export function useDeleteZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/zones/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }),
  })
}
