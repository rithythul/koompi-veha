import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { useAuthStore } from '../stores/auth'
import type { LoginRequest, UserResponse } from '../types/api'

export function useCurrentUser() {
  const setUser = useAuthStore((s) => s.setUser)
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const user = await apiClient<UserResponse>('/api/auth/me')
      setUser(user)
      return user
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useLogin() {
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: LoginRequest) =>
      apiClient<UserResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (user) => {
      setUser(user)
      queryClient.invalidateQueries({ queryKey: ['auth'] })
    },
  })
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient<null>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      logout()
      queryClient.clear()
    },
  })
}
