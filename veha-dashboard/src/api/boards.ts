import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type {
  Board, CreateBoard, UpdateBoard, BoardFilter,
  PaginatedResponse, PlayerCommand, ResolvedPlaylist,
} from '../types/api'

export function useBoards(params?: BoardFilter) {
  return useQuery({
    queryKey: ['boards', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Board>>(
        `/api/boards?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useBoard(id: string) {
  return useQuery({
    queryKey: ['boards', id],
    queryFn: () => apiClient<Board>(`/api/boards/${id}`),
    enabled: !!id,
  })
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBoard) =>
      apiClient<Board>('/api/boards', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  })
}

export function useUpdateBoard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateBoard) =>
      apiClient<Board>(`/api/boards/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boards'] })
      qc.invalidateQueries({ queryKey: ['boards', id] })
    },
  })
}

export function useSendBoardCommand(id: string) {
  return useMutation({
    mutationFn: (command: PlayerCommand) =>
      apiClient<null>(`/api/boards/${id}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      }),
  })
}

export function useBoardResolvedSchedule(id: string) {
  return useQuery({
    queryKey: ['boards', id, 'resolved-schedule'],
    queryFn: () => apiClient<ResolvedPlaylist>(`/api/boards/${id}/resolved-schedule`),
    enabled: !!id,
  })
}
