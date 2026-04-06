import { useState, useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useRevenueReport } from '../api/reports'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../lib/utils'
import type { RevenueReportFilter } from '../types/api'

const GROUP_OPTIONS = [
  { value: 'advertiser', label: 'By Advertiser' },
  { value: 'zone', label: 'By Zone' },
  { value: 'campaign', label: 'By Campaign' },
]

const PIE_COLORS = ['#8b7cf8', '#f59e0b', '#10b981', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#8b5cf6']

function getDefaultDates() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
  return {
    start_date: `${y}-${m}-01`,
    end_date: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
  }
}

function formatDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function getQuickDateRange(preset: string): { start_date: string; end_date: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()

  switch (preset) {
    case 'today':
      return { start_date: formatDateStr(y, m, d), end_date: formatDateStr(y, m, d) }
    case 'last7': {
      const start = new Date(Date.now() - 6 * 86400000)
      return {
        start_date: formatDateStr(start.getFullYear(), start.getMonth() + 1, start.getDate()),
        end_date: formatDateStr(y, m, d),
      }
    }
    case 'this_month': {
      const lastDay = new Date(y, m, 0).getDate()
      return { start_date: formatDateStr(y, m, 1), end_date: formatDateStr(y, m, lastDay) }
    }
    case 'last_month': {
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      const lastDay = new Date(prevYear, prevMonth, 0).getDate()
      return { start_date: formatDateStr(prevYear, prevMonth, 1), end_date: formatDateStr(prevYear, prevMonth, lastDay) }
    }
    default:
      return getDefaultDates()
  }
}

export default function Reports() {
  const defaults = getDefaultDates()
  const [filter, setFilter] = useState<RevenueReportFilter>({
    group_by: 'advertiser',
    start_date: defaults.start_date,
    end_date: defaults.end_date,
  })

  const { data: report, isLoading } = useRevenueReport(filter)

  // Pie chart data for zone distribution
  const pieData = useMemo(() => {
    if (!report || report.rows.length === 0) return []
    return report.rows.map((row) => ({
      name: row.group_name,
      value: row.total_cost,
    }))
  }, [report])

  const applyQuickDate = (preset: string) => {
    const range = getQuickDateRange(preset)
    setFilter({ ...filter, ...range })
  }

  return (
    <div className="animate-fade-in">

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
          <Input
            label="Start Date"
            type="date"
            value={filter.start_date ?? ''}
            onChange={(e) => setFilter({ ...filter, start_date: e.target.value || undefined })}
          />
          <Input
            label="End Date"
            type="date"
            value={filter.end_date ?? ''}
            onChange={(e) => setFilter({ ...filter, end_date: e.target.value || undefined })}
          />
          <Select
            label="Group By"
            value={filter.group_by ?? 'advertiser'}
            onChange={(e) =>
              setFilter({ ...filter, group_by: e.target.value as RevenueReportFilter['group_by'] })
            }
            options={GROUP_OPTIONS}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => applyQuickDate('today')}>Today</Button>
          <Button variant="ghost" size="sm" onClick={() => applyQuickDate('last7')}>Last 7 Days</Button>
          <Button variant="ghost" size="sm" onClick={() => applyQuickDate('this_month')}>This Month</Button>
          <Button variant="ghost" size="sm" onClick={() => applyQuickDate('last_month')}>Last Month</Button>
        </div>
      </Card>

      {isLoading ? (
        <PageSpinner />
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No revenue data"
          description="Revenue data will appear once bookings with cost estimates are created."
        />
      ) : (
        <>
          {/* Summary + Pie Chart */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
            <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4">
              <Card>
                <p className="text-text-muted text-xs mb-1">Total Revenue (estimated)</p>
                <p className="text-2xl font-bold text-text-primary">{formatCurrency(report.total)}</p>
              </Card>
              <Card>
                <p className="text-text-muted text-xs mb-1">Groups</p>
                <p className="text-2xl font-bold text-text-primary">{report.rows.length}</p>
              </Card>
            </div>

            {/* Revenue Distribution Pie Chart */}
            <Card
              title={`Revenue by ${filter.group_by === 'advertiser' ? 'Advertiser' : filter.group_by === 'zone' ? 'Zone' : 'Campaign'}`}
              className="xl:col-span-3"
            >
              {pieData.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        dataKey="value"
                        paddingAngle={2}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'var(--theme-chart-tooltip-bg)',
                          border: '1px solid var(--theme-chart-tooltip-border)',
                          borderRadius: '8px',
                          color: 'var(--theme-chart-tooltip-color)',
                          fontSize: '12px',
                        }}
                        formatter={(value) => [formatCurrency(value as number), 'Revenue']}
                      />
                      <Legend
                        verticalAlign="middle"
                        align="right"
                        layout="vertical"
                        wrapperStyle={{ fontSize: '11px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-text-muted py-8 text-center">No data</p>
              )}
            </Card>
          </div>

          {/* Table */}
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                    <th className="px-4 py-3">
                      {filter.group_by === 'advertiser'
                        ? 'Advertiser'
                        : filter.group_by === 'zone'
                          ? 'Zone'
                          : 'Campaign'}
                    </th>
                    <th className="px-4 py-3 text-right">Bookings</th>
                    <th className="px-4 py-3 text-right">Revenue (est.)</th>
                    <th className="px-4 py-3 text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {report.rows.map((row) => (
                    <tr
                      key={row.group_key}
                      className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors"
                    >
                      <td className="px-4 py-3 text-text-primary font-medium">{row.group_name}</td>
                      <td className="px-4 py-3 text-text-secondary text-right">{row.booking_count}</td>
                      <td className="px-4 py-3 text-text-primary text-right font-medium">
                        {formatCurrency(row.total_cost)}
                      </td>
                      <td className="px-4 py-3 text-text-muted text-right">
                        {report.total > 0
                          ? `${((row.total_cost / report.total) * 100).toFixed(1)}%`
                          : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-default font-semibold">
                    <td className="px-4 py-3 text-text-primary">Total</td>
                    <td className="px-4 py-3 text-text-secondary text-right">
                      {report.rows.reduce((sum, r) => sum + r.booking_count, 0)}
                    </td>
                    <td className="px-4 py-3 text-text-primary text-right">
                      {formatCurrency(report.total)}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-right">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
