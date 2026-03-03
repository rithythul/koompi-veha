import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { Schedule, CreateSchedule, PaginatedResponse } from '../types/api'

export function useSchedules(params?: { page?: number; per_page?: number; board_id?: string; group_id?: string }) {
  return useQuery({
    queryKey: ['schedules', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Schedule>>(
        `/api/schedules?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useCreateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSchedule) =>
      apiClient<Schedule>('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })
}

export function useUpdateSchedule(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSchedule) =>
      apiClient<Schedule>(`/api/schedules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })
}
