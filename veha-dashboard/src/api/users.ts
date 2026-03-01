import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type { UserResponse, CreateUser, UpdateUser, PaginatedResponse } from '../types/api'

export function useUsers(params?: { page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () =>
      apiClient<PaginatedResponse<UserResponse>>(
        `/api/users?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateUser) =>
      apiClient<UserResponse>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateUser) =>
      apiClient<UserResponse>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}
