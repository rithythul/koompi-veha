import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { Group, CreateGroup, PaginatedResponse, PlayerCommand } from '../types/api'

export function useGroups(params?: { page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['groups', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Group>>(
        `/api/groups?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useCreateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateGroup) =>
      apiClient<Group>('/api/groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateGroup) =>
      apiClient<Group>(`/api/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useDeleteGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useSendGroupCommand(id: string) {
  return useMutation({
    mutationFn: (command: PlayerCommand) =>
      apiClient<{ boards_total: number; boards_sent: number }>(
        `/api/groups/${id}/command`,
        { method: 'POST', body: JSON.stringify({ command }) },
      ),
  })
}
