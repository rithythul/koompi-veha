import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Wifi, Megaphone, BarChart3, DollarSign, Clock, WifiOff,
  AlertTriangle, CirclePlus, Activity, AlertCircle, Info, ShieldAlert,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { useBoards } from '../api/boards'
import { useCampaigns } from '../api/campaigns'
import { useAdvertisers } from '../api/advertisers'
import { usePlayLogSummary } from '../api/playlogs'
import { useAlerts } from '../api/alerts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { cn, formatRelativeTime, formatCurrency, formatDate } from '../lib/utils'
import { useBoardStatus } from '../hooks/useBoardStatus'

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  onClick,
}: {
  icon: typeof Monitor
  label: string
  value: string | number
  sub?: string
  color: string
  onClick?: () => void
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'bg-bg-surface border border-border-default rounded-lg p-4 text-left',
        onClick && 'hover:border-border-hover transition-colors cursor-pointer',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', color)}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
          <p className="text-xs text-text-secondary">{label}</p>
        </div>
      </div>
      {sub && <p className="text-xs text-text-muted mt-2">{sub}</p>}
    </Wrapper>
  )
}

const BAR_COLORS = ['#8b7cf8', '#f59e0b', '#10b981', '#ec4899', '#6366f1']

export default function Dashboard() {
  useBoardStatus()
  const navigate = useNavigate()
  const { data: boardsData, isLoading: boardsLoading } = useBoards({ per_page: 200 })
  const { data: activeCampaignsData } = useCampaigns({ status: 'active', per_page: 200 })
  const { data: allCampaignsData } = useCampaigns({ per_page: 200 })
  const { data: advData } = useAdvertisers({ per_page: 200 })

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const { data: summaryData } = usePlayLogSummary({ start_date: weekAgo, end_date: today })
  const { data: alertsData } = useAlerts({ per_page: 10, acknowledged: false })

  const boards = boardsData?.data ?? []
  const onlineCount = boards.filter((b) => b.status === 'online').length
  const offlineCount = boards.filter((b) => b.status !== 'online').length
  const totalBoards = boardsData?.total ?? 0
  const activeCampaigns = activeCampaignsData?.data ?? []
  const allCampaigns = allCampaignsData?.data ?? []
  const advertisers = advData?.data ?? []

  // Fleet uptime: boards seen in last 1 hour vs total
  const fleetUptime = useMemo(() => {
    if (boards.length === 0) return null
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const recentlySeenCount = boards.filter((b) => {
      if (!b.last_seen) return false
      return new Date(b.last_seen).getTime() > oneHourAgo
    }).length
    return Math.round((recentlySeenCount / boards.length) * 100)
  }, [boards])

  // Board name map for alerts
  const boardNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of boards) m.set(b.id, b.name)
    return m
  }, [boards])

  const recentAlerts = alertsData?.data ?? []

  // Revenue: sum of active campaign budgets
  const totalRevenue = useMemo(() => {
    return activeCampaigns.reduce((sum, c) => sum + (c.budget ?? 0), 0)
  }, [activeCampaigns])

  // Expiring soon: campaigns ending within 7 days
  const expiringSoon = useMemo(() => {
    const sevenDaysFromNow = Date.now() + 7 * 86400000
    return allCampaigns.filter((c) => {
      if (c.status !== 'active') return false
      const endDate = new Date(c.end_date).getTime()
      return endDate > Date.now() && endDate <= sevenDaysFromNow
    })
  }, [allCampaigns])

  // Today's plays
  const todayPlays = useMemo(() => {
    if (!summaryData) return 0
    return summaryData
      .filter((s) => s.date === today)
      .reduce((acc, s) => acc + s.play_count, 0)
  }, [summaryData, today])

  // 7-day chart data
  const chartData = useMemo(() => {
    if (!summaryData) return []
    const byDate = new Map<string, number>()
    for (const s of summaryData) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.play_count)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, plays]) => ({
        date: date.slice(5),
        plays,
      }))
  }, [summaryData])

  // Revenue by advertiser (top 5)
  const revenueByAdvertiser = useMemo(() => {
    const byAdvId = new Map<string, number>()
    for (const c of activeCampaigns) {
      if (c.budget) {
        byAdvId.set(c.advertiser_id, (byAdvId.get(c.advertiser_id) ?? 0) + c.budget)
      }
    }
    return Array.from(byAdvId.entries())
      .map(([advId, total]) => ({
        name: advertisers.find((a) => a.id === advId)?.name ?? 'Unknown',
        revenue: total,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }, [activeCampaigns, advertisers])

  // Recent activity feed
  const activityFeed = useMemo(() => {
    const items: Array<{
      icon: typeof Monitor
      iconColor: string
      text: string
      time: string
      sortKey: number
    }> = []

    // Last 5 boards by last_seen
    const recentBoards = [...boards]
      .filter((b) => b.last_seen)
      .sort((a, b) => new Date(b.last_seen!).getTime() - new Date(a.last_seen!).getTime())
      .slice(0, 5)

    for (const board of recentBoards) {
      const isOnline = board.status === 'online'
      items.push({
        icon: isOnline ? Wifi : WifiOff,
        iconColor: isOnline ? 'text-status-online' : 'text-status-neutral',
        text: `${board.name} went ${isOnline ? 'online' : 'offline'}`,
        time: formatRelativeTime(board.last_seen),
        sortKey: new Date(board.last_seen!).getTime(),
      })
    }

    // Last 3 active campaigns (recent ones)
    const recentCampaigns = [...activeCampaigns]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3)

    for (const campaign of recentCampaigns) {
      items.push({
        icon: CirclePlus,
        iconColor: 'text-accent',
        text: `Campaign "${campaign.name}" created`,
        time: formatRelativeTime(campaign.created_at),
        sortKey: new Date(campaign.created_at).getTime(),
      })
    }

    return items.sort((a, b) => b.sortKey - a.sortKey).slice(0, 8)
  }, [boards, activeCampaigns])

  if (boardsLoading) return <PageSpinner />

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-xl font-bold text-text-primary">Overview</h1>

      {/* Expiring Campaigns Warning */}
      {expiringSoon.length > 0 && (
        <button
          onClick={() => navigate('/campaigns')}
          className="w-full flex items-start gap-3 bg-status-warning/10 border border-status-warning/30 rounded-lg p-4 text-left cursor-pointer hover:bg-status-warning/15 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-text-primary">
              {expiringSoon.length} campaign{expiringSoon.length > 1 ? 's' : ''} expiring within 7 days
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {expiringSoon.map((c) => `${c.name} (${formatDate(c.end_date)})`).join(' · ')}
            </p>
          </div>
        </button>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={Monitor}
          label="Total Boards"
          value={totalBoards}
          color="bg-accent/15 text-accent"
        />
        <KpiCard
          icon={Wifi}
          label="Online"
          value={onlineCount}
          sub={totalBoards > 0 ? `${Math.round((onlineCount / totalBoards) * 100)}% of fleet` : undefined}
          color="bg-status-online/15 text-status-online"
        />
        <KpiCard
          icon={Megaphone}
          label="Active Campaigns"
          value={activeCampaigns.length}
          color="bg-status-warning/15 text-status-warning"
        />
        <KpiCard
          icon={BarChart3}
          label="Plays Today"
          value={todayPlays}
          color="bg-status-info/15 text-status-info"
        />
      </div>

      {/* Campaign Performance KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={Activity}
          label="Fleet Uptime (1h)"
          value={fleetUptime != null ? `${fleetUptime}%` : '--'}
          sub={fleetUptime != null
            ? fleetUptime >= 90 ? 'Healthy' : fleetUptime >= 70 ? 'Degraded' : 'Critical'
            : 'No boards'}
          color={
            fleetUptime == null || fleetUptime >= 90
              ? 'bg-status-online/15 text-status-online'
              : fleetUptime >= 70
                ? 'bg-status-warning/15 text-status-warning'
                : 'bg-status-error/15 text-status-error'
          }
        />
        <KpiCard
          icon={DollarSign}
          label="Revenue"
          value={formatCurrency(totalRevenue > 0 ? totalRevenue : null)}
          sub="Sum of active campaign budgets"
          color="bg-status-online/15 text-status-online"
        />
        <KpiCard
          icon={Clock}
          label="Expiring Soon"
          value={expiringSoon.length}
          sub={expiringSoon.length > 0 ? 'Within next 7 days' : 'No campaigns expiring soon'}
          color="bg-status-warning/15 text-status-warning"
          onClick={() => navigate('/campaigns')}
        />
        <KpiCard
          icon={WifiOff}
          label="Offline Alerts"
          value={offlineCount}
          sub={offlineCount > 0 ? `${offlineCount} board${offlineCount > 1 ? 's' : ''} need attention` : 'All boards online'}
          color="bg-status-error/15 text-status-error"
          onClick={() => navigate('/alerts')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Plays Chart */}
        <Card title="Plays (7 days)" className="xl:col-span-3">
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="playsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b7cf8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b7cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--theme-chart-tick)', fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--theme-chart-tick)', fontSize: 11 }}
                    width={35}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--theme-chart-tooltip-bg)',
                      border: '1px solid var(--theme-chart-tooltip-border)',
                      borderRadius: '8px',
                      color: 'var(--theme-chart-tooltip-color)',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="plays"
                    stroke="#8b7cf8"
                    strokeWidth={2}
                    fill="url(#playsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-muted py-8 text-center">No play data yet</p>
          )}
        </Card>

        {/* Board Status Grid */}
        <Card title="Board Status" className="xl:col-span-2">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {boards.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center">No boards</p>
            ) : (
              [...boards]
                .sort((a, b) => {
                  if (a.status === 'online' && b.status !== 'online') return -1
                  if (a.status !== 'online' && b.status === 'online') return 1
                  return a.name.localeCompare(b.name)
                })
                .map((board) => (
                  <button
                    key={board.id}
                    onClick={() => navigate(`/boards/${board.id}`)}
                    className="flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-bg-elevated transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full flex-shrink-0',
                          board.status === 'online'
                            ? 'bg-status-online animate-pulse-dot'
                            : 'bg-status-neutral',
                        )}
                      />
                      <span className="text-sm text-text-primary truncate">{board.name}</span>
                    </div>
                    <span className="text-xs text-text-muted flex-shrink-0 ml-2">
                      {formatRelativeTime(board.last_seen)}
                    </span>
                  </button>
                ))
            )}
          </div>
        </Card>
      </div>

      {/* Revenue by Advertiser + Recent Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Revenue by Advertiser */}
        <Card title="Revenue by Advertiser" className="xl:col-span-3">
          {revenueByAdvertiser.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByAdvertiser} layout="vertical">
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--theme-chart-tick)', fontSize: 11 }}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--theme-chart-tick)', fontSize: 11 }}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--theme-chart-tooltip-bg)',
                      border: '1px solid var(--theme-chart-tooltip-border)',
                      borderRadius: '8px',
                      color: 'var(--theme-chart-tooltip-color)',
                      fontSize: '12px',
                    }}
                    formatter={(value) => [formatCurrency(value as number), 'Budget']}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {revenueByAdvertiser.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-muted py-8 text-center">No revenue data yet</p>
          )}
        </Card>

        {/* Recent Activity */}
        <Card title="Recent Activity" className="xl:col-span-2">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {activityFeed.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center">No recent activity</p>
            ) : (
              activityFeed.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md"
                >
                  <item.icon className={cn('w-3.5 h-3.5 flex-shrink-0', item.iconColor)} />
                  <span className="text-sm text-text-primary truncate flex-1">{item.text}</span>
                  <span className="text-xs text-text-muted flex-shrink-0">{item.time}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Recent Alerts */}
      <Card
        title="Recent Alerts"
        action={
          <button
            onClick={() => navigate('/alerts')}
            className="text-xs text-accent hover:underline cursor-pointer"
          >
            View all
          </button>
        }
      >
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {recentAlerts.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">No unacknowledged alerts</p>
          ) : (
            recentAlerts.map((alert) => {
              const SeverityIcon =
                alert.severity === 'critical' ? ShieldAlert
                  : alert.severity === 'warning' ? AlertTriangle
                    : alert.severity === 'error' ? AlertCircle
                      : Info
              const severityColor =
                alert.severity === 'critical' ? 'text-status-error'
                  : alert.severity === 'warning' ? 'text-status-warning'
                    : alert.severity === 'error' ? 'text-status-error'
                      : 'text-status-info'

              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-bg-elevated transition-colors"
                >
                  <SeverityIcon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', severityColor)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">{alert.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {alert.board_id && (
                        <span className="text-xs text-text-muted">
                          {boardNameMap.get(alert.board_id) ?? alert.board_id.slice(0, 8)}
                        </span>
                      )}
                      <Badge variant={
                        alert.severity === 'critical' ? 'error'
                          : alert.severity === 'warning' ? 'warning'
                            : alert.severity === 'error' ? 'error'
                              : 'info'
                      }>
                        {alert.severity}
                      </Badge>
                    </div>
                  </div>
                  <span className="text-xs text-text-muted flex-shrink-0">
                    {formatRelativeTime(alert.created_at)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </Card>
    </div>
  )
}
