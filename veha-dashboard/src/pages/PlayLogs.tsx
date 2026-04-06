import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Download } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { usePlayLogs, usePlayLogSummary } from '../api/playlogs'
import { useBoards } from '../api/boards'
import { useMedia, mediaThumbnailUrl } from '../api/media'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { formatDateTime, formatDuration } from '../lib/utils'
import type { PlayLog } from '../types/api'

const STATUS_VARIANTS: Record<string, 'online' | 'offline' | 'warning' | 'info' | 'default'> = {
  completed: 'online',
  playing: 'info',
  failed: 'offline',
  skipped: 'warning',
}

export default function PlayLogs() {
  const defaultEnd = new Date().toISOString().split('T')[0]
  const defaultStart = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [page, setPage] = useState(1)

  const { data, isLoading } = usePlayLogs({
    start_date: startDate,
    end_date: endDate,
    page,
    per_page: 50,
  })

  const { data: summary } = usePlayLogSummary({
    start_date: startDate,
    end_date: endDate,
  })

  // Reference data for name lookups
  const { data: boardsData } = useBoards({ per_page: 200 })
  const { data: mediaData } = useMedia({ per_page: 200 })

  const boardMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of boardsData?.data ?? []) m.set(b.id, b.name)
    return m
  }, [boardsData])

  const mediaMap = useMemo(() => {
    const m = new Map<string, { name: string; id: string }>()
    for (const media of mediaData?.data ?? []) m.set(media.id, { name: media.name, id: media.id })
    return m
  }, [mediaData])

  const stats = useMemo(() => {
    if (!summary) return { plays: 0, duration: 0, boards: 0 }
    const boards = new Set(summary.map((s) => s.board_id))
    return {
      plays: summary.reduce((a, s) => a + s.play_count, 0),
      duration: summary.reduce((a, s) => a + s.total_duration_secs, 0),
      boards: boards.size,
    }
  }, [summary])

  // Daily trend chart data
  const chartData = useMemo(() => {
    if (!summary) return []
    const byDate = new Map<string, number>()
    for (const s of summary) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.play_count)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, plays]) => ({
        date: date.slice(5), // MM-DD
        plays,
      }))
  }, [summary])

  const exportCsv = useCallback((rows: PlayLog[]) => {
    const header = 'ID,Board,Booking ID,Creative ID,Media,Started At,Ended At,Duration (s),Status\n'
    const csvContent = rows.map((r) =>
      [r.id, boardMap.get(r.board_id) ?? r.board_id, r.booking_id ?? '', r.creative_id ?? '',
       r.media_id ? (mediaMap.get(r.media_id)?.name ?? r.media_id) : '',
       r.started_at, r.ended_at ?? '', r.duration_secs ?? '', r.status]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    ).join('\n')
    const blob = new Blob([header + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `play-logs-${startDate}-to-${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [startDate, endDate, boardMap, mediaMap])

  if (isLoading) return <PageSpinner />

  const logs = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-end mb-6">
        {logs.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => exportCsv(logs)}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{stats.plays.toLocaleString()}</p>
          <p className="text-xs text-text-secondary mt-1">Total Plays</p>
        </Card>
        <Card>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{formatDuration(stats.duration)}</p>
          <p className="text-xs text-text-secondary mt-1">Total Duration</p>
        </Card>
        <Card>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{stats.boards}</p>
          <p className="text-xs text-text-secondary mt-1">Unique Boards</p>
        </Card>
      </div>

      {/* Plays Trend Chart */}
      {chartData.length > 0 && (
        <Card title="Plays per Day" className="mb-6">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="playsTrendGradient" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#playsTrendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <Button variant="secondary" onClick={() => setPage(1)}>Filter</Button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon={BarChart3} title="No play logs" description="Play logs appear as boards play content." />
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Board</th>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Media</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {logs.map((log) => {
                  const boardName = boardMap.get(log.board_id)
                  const media = log.media_id ? mediaMap.get(log.media_id) : null
                  // booking_id doesn't directly give us campaign name without a join,
                  // but we can look it up if we had bookings data. For now show booking_id short.
                  return (
                    <tr key={log.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {formatDateTime(log.started_at)}
                      </td>
                      <td className="px-4 py-3">
                        {boardName ? (
                          <Link
                            to={`/boards/${log.board_id}`}
                            className="text-accent hover:underline font-medium"
                          >
                            {boardName}
                          </Link>
                        ) : (
                          <span className="text-text-muted font-mono text-xs">{log.board_id.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {log.booking_id ? log.booking_id.slice(0, 8) : '--'}
                      </td>
                      <td className="px-4 py-3">
                        {media ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={mediaThumbnailUrl(media.id)}
                              alt=""
                              className="w-8 h-8 rounded object-cover bg-bg-elevated flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                            <span className="text-text-primary truncate max-w-[140px]">{media.name}</span>
                          </div>
                        ) : (
                          <span className="text-text-muted">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary tabular-nums whitespace-nowrap">
                        {log.duration_secs != null ? formatDuration(log.duration_secs) : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[log.status] ?? 'default'}>
                          {log.status}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
