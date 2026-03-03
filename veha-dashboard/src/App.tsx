import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from './components/ui/Toast'
import { FullScreenSpinner } from './components/ui/Spinner'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'
import { ErrorBoundary } from './components/ErrorBoundary'

const AppLayout = lazy(() => import('./components/layout/AppLayout'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Boards = lazy(() => import('./pages/Boards'))
const BoardDetail = lazy(() => import('./pages/BoardDetail'))
const Zones = lazy(() => import('./pages/Zones'))
const MediaLibrary = lazy(() => import('./pages/MediaLibrary'))
const Playlists = lazy(() => import('./pages/Playlists'))
const PlaylistEditor = lazy(() => import('./pages/PlaylistEditor'))
const Campaigns = lazy(() => import('./pages/Campaigns'))
const CampaignDetail = lazy(() => import('./pages/CampaignDetail'))
const Bookings = lazy(() => import('./pages/Bookings'))
const Advertisers = lazy(() => import('./pages/Advertisers'))
const PlayLogs = lazy(() => import('./pages/PlayLogs'))
const Schedules = lazy(() => import('./pages/Schedules'))
const Reports = lazy(() => import('./pages/Reports'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Settings = lazy(() => import('./pages/Settings'))
const Users = lazy(() => import('./pages/Users'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

export default function App() {
  const logout = useAuthStore((s) => s.logout)
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const handler = () => {
      logout()
      queryClient.setQueryData(['auth', 'me'], null)
    }
    window.addEventListener('auth:unauthorized', handler)
    return () => window.removeEventListener('auth:unauthorized', handler)
  }, [logout])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<FullScreenSpinner />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/boards" element={<Boards />} />
                <Route path="/boards/:id" element={<BoardDetail />} />
                <Route path="/zones" element={<Zones />} />
                <Route path="/media" element={<MediaLibrary />} />
                <Route path="/playlists" element={<Playlists />} />
                <Route path="/playlists/:id/edit" element={<PlaylistEditor />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/campaigns/:id" element={<CampaignDetail />} />
                <Route path="/bookings" element={<Bookings />} />
                <Route path="/advertisers" element={<Advertisers />} />
                <Route path="/playlogs" element={<PlayLogs />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/users" element={<Users />} />
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  )
}
