import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const stored = localStorage.getItem('veha-theme') as Theme | null

export const useThemeStore = create<ThemeState>((set) => ({
  theme: stored ?? 'dark',
  setTheme: (theme) => {
    localStorage.setItem('veha-theme', theme)
    set({ theme })
  },
  toggle: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('veha-theme', next)
      return { theme: next }
    }),
}))
