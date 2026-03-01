import { create } from 'zustand'
import type { UserResponse } from '../types/api'

interface AuthState {
  user: UserResponse | null
  isAuthenticated: boolean
  setUser: (user: UserResponse | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => set({ user: null, isAuthenticated: false }),
}))
