import { useState, useMemo, useCallback } from 'react'
import { BarChart3, Download } from 'lucide-react'
import { usePlayLogs, usePlayLogSummary } from '../api/playlogs'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { formatDateTime, formatDuration } from '../lib/utils'
import type { PlayLog } from '../types/api'

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

  const stats = useMemo(() => {
    if (!summary) return { plays: 0, duration: 0, boards: 0 }
    const boards = new Set(summary.map((s) => s.board_id))
    return {
      plays: summary.reduce((a, s) => a + s.play_count, 0),
      duration: summary.reduce((a, s) => a + s.total_duration_secs, 0),
      boards: boards.size,
    }
  }, [summary])

  const exportCsv = useCallback((rows: PlayLog[]) => {
    const header = 'ID,Board ID,Booking ID,Creative ID,Media ID,Started At,Ended At,Duration (s),Status\n'
    const csvContent = rows.map((r) =>
      [r.id, r.board_id, r.booking_id ?? '', r.creative_id ?? '', r.media_id ?? '',
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
  }, [startDate, endDate])

  if (isLoading) return <PageSpinner />

  const logs = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Play Logs</h1>
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
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Board</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-3 text-text-primary font-mono text-xs">{log.board_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">{log.booking_id?.slice(0, 8) ?? '--'}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDateTime(log.started_at)}</td>
                  <td className="px-4 py-3 text-text-secondary">{log.duration_secs ? formatDuration(log.duration_secs) : '--'}</td>
                  <td className="px-4 py-3">
                    <Badge variant="online">{log.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
