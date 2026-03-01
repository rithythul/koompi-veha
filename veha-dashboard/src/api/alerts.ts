import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { BoardAlert, AlertFilter, AlertCount, PaginatedResponse } from '../types/api'

export function useAlerts(params?: AlertFilter) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () =>
      apiClient<PaginatedResponse<BoardAlert>>(
        `/api/alerts?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useAlertCount() {
  return useQuery({
    queryKey: ['alerts', 'count'],
    queryFn: () => apiClient<AlertCount>('/api/alerts/count'),
    refetchInterval: 60_000,
  })
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
