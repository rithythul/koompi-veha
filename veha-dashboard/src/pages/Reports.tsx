import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useRevenueReport } from '../api/reports'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../lib/utils'
import type { RevenueReportFilter } from '../types/api'

const GROUP_OPTIONS = [
  { value: 'advertiser', label: 'By Advertiser' },
  { value: 'zone', label: 'By Zone' },
  { value: 'campaign', label: 'By Campaign' },
]

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

export default function Reports() {
  const defaults = getDefaultDates()
  const [filter, setFilter] = useState<RevenueReportFilter>({
    group_by: 'advertiser',
    start_date: defaults.start_date,
    end_date: defaults.end_date,
  })

  const { data: report, isLoading } = useRevenueReport(filter)

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Revenue Reports</h1>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Card>
              <p className="text-text-muted text-xs mb-1">Total Revenue (estimated)</p>
              <p className="text-2xl font-bold text-text-primary">{formatCurrency(report.total)}</p>
            </Card>
            <Card>
              <p className="text-text-muted text-xs mb-1">Groups</p>
              <p className="text-2xl font-bold text-text-primary">{report.rows.length}</p>
            </Card>
          </div>

          {/* Table */}
          <Card padding={false}>
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
          </Card>
        </>
      )}
    </div>
  )
}
