import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Monitor,
  MapPin,
  FolderOpen,
  Image,
  ListVideo,
  Building2,
  Megaphone,
  CalendarCheck,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Clock,
  Settings,
  Users,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'

interface NavItem {
  label: string
  path: string
  icon: typeof LayoutDashboard
  adminOnly?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    title: '',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Fleet',
    items: [
      { label: 'Boards', path: '/boards', icon: Monitor },
      { label: 'Zones', path: '/zones', icon: MapPin },
      { label: 'Groups', path: '/groups', icon: FolderOpen },
    ],
  },
  {
    title: 'Content',
    items: [
      { label: 'Media Library', path: '/media', icon: Image },
      { label: 'Playlists', path: '/playlists', icon: ListVideo },
    ],
  },
  {
    title: 'Advertising',
    items: [
      { label: 'Advertisers', path: '/advertisers', icon: Building2 },
      { label: 'Campaigns', path: '/campaigns', icon: Megaphone },
      { label: 'Bookings', path: '/bookings', icon: CalendarCheck },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { label: 'Play Logs', path: '/playlogs', icon: BarChart3 },
      { label: 'Reports', path: '/reports', icon: TrendingUp },
      { label: 'Alerts', path: '/alerts', icon: AlertTriangle },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Schedules', path: '/schedules', icon: Clock },
      { label: 'Settings', path: '/settings', icon: Settings, adminOnly: true },
      { label: 'Users', path: '/users', icon: Users, adminOnly: true },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const filteredSections = useMemo(() => {
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.adminOnly || isAdmin),
      }))
      .filter((section) => section.items.length > 0)
  }, [isAdmin])

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <aside
      className={cn(
        'bg-bg-sidebar border-r border-border-default flex flex-col flex-shrink-0 transition-all duration-200',
        collapsed ? 'w-[56px]' : 'w-60',
      )}
    >
      {/* Brand */}
      <div className={cn(
        'flex items-center gap-3 border-b border-border-default flex-shrink-0 h-14',
        collapsed ? 'px-3 justify-center' : 'px-4',
      )}>
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">V</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-text-primary tracking-tight leading-none">
              Veha
            </h1>
            <p className="text-[10px] text-text-muted mt-0.5">Billboard Platform</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {filteredSections.map((section, si) => (
          <div key={si} className={cn(si > 0 && 'mt-4')}>
            {section.title && !collapsed && (
              <p className="px-4 mb-1 text-[10px] font-semibold text-text-muted uppercase tracking-widest">
                {section.title}
              </p>
            )}
            {section.title && collapsed && si > 0 && (
              <div className="mx-3 mb-2 border-t border-border-default" />
            )}
            <div className={cn('space-y-0.5', collapsed ? 'px-1.5' : 'px-2')}>
              {section.items.map((item) => {
                const active = isActive(item.path)
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-2.5 w-full rounded-md text-sm font-medium transition-colors cursor-pointer',
                      collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
                      active
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary',
                    )}
                  >
                    <item.icon className={cn('flex-shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border-default p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center gap-2 w-full rounded-md py-2 text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer',
            collapsed ? 'justify-center px-2' : 'px-3',
          )}
        >
          {collapsed ? (
            <PanelLeft className="w-4 h-4" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
        {!collapsed && (
          <p className="text-[10px] text-text-muted px-3 mt-1">v0.2.0</p>
        )}
      </div>
    </aside>
  )
}
