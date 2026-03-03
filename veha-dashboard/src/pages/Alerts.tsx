import { useState } from 'react'
import { AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { useAlerts, useAcknowledgeAlert } from '../api/alerts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatDateTime } from '../lib/utils'

type Tab = 'unacknowledged' | 'all' | 'acknowledged'

const severityVariant: Record<string, 'warning' | 'default' | 'info'> = {
  warning: 'warning',
  error: 'warning',
  info: 'info',
}

const severityIcon: Record<string, typeof AlertTriangle> = {
  warning: AlertTriangle,
  error: AlertTriangle,
  info: Info,
}

export default function Alerts() {
  const [tab, setTab] = useState<Tab>('unacknowledged')
  const [page, setPage] = useState(1)
  const toast = useToast()
  const acknowledge = useAcknowledgeAlert()

  const filter = {
    acknowledged: tab === 'all' ? undefined : tab === 'acknowledged',
    page,
    per_page: 30,
  }

  const { data, isLoading } = useAlerts(filter)
  const alerts = data?.data ?? []
  const total = data?.total ?? 0

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledge.mutateAsync(id)
      toast.success('Alert acknowledged')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (isLoading) return <PageSpinner />

  const tabs: { key: Tab; label: string }[] = [
    { key: 'unacknowledged', label: 'Active' },
    { key: 'all', label: 'All' },
    { key: 'acknowledged', label: 'Acknowledged' },
  ]

  return (
    <div className="animate-fade-in">
      <p className="text-xs text-text-secondary mb-6">Board status and campaign notifications</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-bg-elevated rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(1) }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
              tab === t.key
                ? 'bg-bg-surface text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {alerts.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title={tab === 'unacknowledged' ? 'No active alerts' : 'No alerts found'}
            description={
              tab === 'unacknowledged'
                ? 'All boards are operating normally.'
                : 'No alerts match the current filter.'
            }
          />
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => {
              const SeverityIcon = severityIcon[alert.severity] ?? Info
              return (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${
                    alert.acknowledged
                      ? 'bg-bg-primary border-border-default opacity-60'
                      : 'bg-bg-surface border-border-default'
                  }`}
                >
                  <SeverityIcon
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      alert.severity === 'error'
                        ? 'text-status-error'
                        : alert.severity === 'warning'
                          ? 'text-status-warning'
                          : 'text-status-info'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant={severityVariant[alert.severity] ?? 'default'} className="text-[10px]">
                        {alert.alert_type.replace('_', ' ')}
                      </Badge>
                      <span className="text-xs text-text-muted">{formatDateTime(alert.created_at)}</span>
                    </div>
                    <p className="text-sm text-text-primary">{alert.message}</p>
                    {alert.acknowledged_at && (
                      <p className="text-xs text-text-muted mt-1">
                        Acknowledged {formatDateTime(alert.acknowledged_at)}
                      </p>
                    )}
                  </div>
                  {!alert.acknowledged && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAcknowledge(alert.id)}
                      loading={acknowledge.isPending}
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {total > 30 && (
        <div className="mt-4">
          <Pagination page={page} totalPages={Math.ceil(total / 30)} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
