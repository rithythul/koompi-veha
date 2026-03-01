import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Wifi, Megaphone, BarChart3 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useBoards } from '../api/boards'
import { useCampaigns } from '../api/campaigns'
import { usePlayLogSummary } from '../api/playlogs'
import { Card } from '../components/ui/Card'
import { PageSpinner } from '../components/ui/Spinner'
import { cn, formatRelativeTime } from '../lib/utils'
import { useBoardStatus } from '../hooks/useBoardStatus'

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Monitor
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
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
    </div>
  )
}

export default function Dashboard() {
  useBoardStatus()
  const navigate = useNavigate()
  const { data: boardsData, isLoading: boardsLoading } = useBoards({ per_page: 200 })
  const { data: campaignsData } = useCampaigns({ status: 'active', per_page: 1 })

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const { data: summaryData } = usePlayLogSummary({ start_date: weekAgo, end_date: today })

  const boards = boardsData?.data ?? []
  const onlineCount = boards.filter((b) => b.status === 'online').length
  const totalBoards = boardsData?.total ?? 0
  const activeCampaigns = campaignsData?.total ?? 0

  const todayPlays = useMemo(() => {
    if (!summaryData) return 0
    return summaryData
      .filter((s) => s.date === today)
      .reduce((acc, s) => acc + s.play_count, 0)
  }, [summaryData, today])

  const chartData = useMemo(() => {
    if (!summaryData) return []
    const byDate = new Map<string, number>()
    for (const s of summaryData) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.play_count)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, plays]) => ({
        date: date.slice(5), // MM-DD
        plays,
      }))
  }, [summaryData])

  if (boardsLoading) return <PageSpinner />

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI Cards */}
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
          value={activeCampaigns}
          color="bg-status-warning/15 text-status-warning"
        />
        <KpiCard
          icon={BarChart3}
          label="Plays Today"
          value={todayPlays}
          color="bg-status-info/15 text-status-info"
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
    </div>
  )
}
