import { useLocation } from 'react-router-dom'
import { LogOut, Sun, Moon } from 'lucide-react'
import { useAuthStore } from '../../stores/auth'
import { useThemeStore } from '../../stores/theme'
import { useLogout } from '../../api/auth'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/boards': 'Boards',
  '/zones': 'Zones',
  '/groups': 'Groups',
  '/media': 'Media Library',
  '/playlists': 'Playlists',
  '/advertisers': 'Advertisers',
  '/campaigns': 'Campaigns',
  '/bookings': 'Bookings',
  '/playlogs': 'Play Logs',
  '/schedules': 'Schedules',
  '/users': 'Users',
}

export function Header() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const { theme, toggle: toggleTheme } = useThemeStore()
  const logout = useLogout()

  const pathKey = Object.keys(pageTitles).find((k) =>
    location.pathname.startsWith(k),
  )
  const title = pathKey ? pageTitles[pathKey] : ''

  // For detail pages, show parent + detail
  let displayTitle = title
  if (location.pathname.match(/^\/boards\/.+/)) displayTitle = 'Board Detail'
  if (location.pathname.match(/^\/campaigns\/.+/)) displayTitle = 'Campaign Detail'
  if (location.pathname.match(/^\/playlists\/.+\/edit/)) displayTitle = 'Edit Playlist'

  return (
    <header className="h-14 bg-bg-surface border-b border-border-default flex items-center justify-between px-6 flex-shrink-0">
      <h2 className="text-base font-semibold text-text-primary">{displayTitle}</h2>
      <div className="flex items-center gap-3">
        <div id="header-actions" />
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-3 pl-3 border-l border-border-default">
          <span className="text-xs text-text-secondary">{user?.username}</span>
          <button
            onClick={() => logout.mutate()}
            className="p-1.5 rounded-md text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors cursor-pointer"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
