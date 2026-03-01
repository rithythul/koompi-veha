import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, Plus, LayoutGrid, Table2 } from 'lucide-react'
import { useCampaigns, useCreateCampaign } from '../api/campaigns'
import { useAdvertisers } from '../api/advertisers'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import type { CreateCampaign, Campaign } from '../types/api'

const statusVariant: Record<string, 'info' | 'online' | 'warning' | 'default'> = {
  draft: 'info',
  active: 'online',
  paused: 'warning',
}

export default function Campaigns() {
  const navigate = useNavigate()
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const { data, isLoading } = useCampaigns({ per_page: 200 })
  const { data: advData } = useAdvertisers({ per_page: 200 })
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<CreateCampaign>({
    advertiser_id: '',
    name: '',
    start_date: '',
    end_date: '',
  })
  const createCampaign = useCreateCampaign()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const campaigns = data?.data ?? []
  const advertisers = advData?.data ?? []
  const getAdvName = (id: string) => advertisers.find((a) => a.id === id)?.name ?? id

  const grouped = {
    draft: campaigns.filter((c) => c.status === 'draft'),
    active: campaigns.filter((c) => c.status === 'active'),
    paused: campaigns.filter((c) => c.status === 'paused'),
  }

  const openCreate = () => {
    setFormData({
      advertiser_id: advertisers[0]?.id ?? '',
      name: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
    })
    setShowForm(true)
  }

  const handleCreate = () => {
    createCampaign.mutate(formData, {
      onSuccess: () => {
        toast.success('Campaign created')
        setShowForm(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const CampaignCard = ({ campaign }: { campaign: Campaign }) => (
    <button
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      className="w-full bg-bg-primary border border-border-default rounded-lg p-3 text-left hover:border-border-hover transition-colors cursor-pointer"
    >
      <p className="text-sm font-medium text-text-primary truncate">{campaign.name}</p>
      <p className="text-xs text-text-secondary mt-1">{getAdvName(campaign.advertiser_id)}</p>
      <p className="text-xs text-text-muted mt-1">
        {formatDate(campaign.start_date)} - {formatDate(campaign.end_date)}
      </p>
    </button>
  )

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Campaigns</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-bg-surface border border-border-default rounded-lg overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                view === 'kanban' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                view === 'table' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4" /> New Campaign
          </Button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns"
          description="Create campaigns to manage advertising content."
          action={{ label: 'New Campaign', onClick: openCreate }}
        />
      ) : view === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['draft', 'active', 'paused'] as const).map((status) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <Badge variant={statusVariant[status]}>{status}</Badge>
                <span className="text-xs text-text-muted">{grouped[status].length}</span>
              </div>
              <div className="space-y-2">
                {grouped[status].map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
                {grouped[status].length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">No {status} campaigns</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Advertiser</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-text-primary font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{getAdvName(c.advertiser_id)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[c.status] ?? 'default'}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(c.start_date)} - {formatDate(c.end_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={createCampaign.isPending} disabled={!formData.name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Advertiser"
            value={formData.advertiser_id}
            onChange={(e) => setFormData({ ...formData, advertiser_id: e.target.value })}
            options={advertisers.map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Select advertiser"
          />
          <Input label="Campaign Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Q1 Billboard Campaign" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Date" type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
            <Input label="End Date" type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
          </div>
          <Textarea label="Notes" value={formData.notes ?? ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value || undefined })} />
        </div>
      </Modal>
    </div>
  )
}
