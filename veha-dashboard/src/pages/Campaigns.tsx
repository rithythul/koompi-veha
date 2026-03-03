import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, Plus, Pencil, Trash2, LayoutGrid, Table2 } from 'lucide-react'
import { useCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign } from '../api/campaigns'
import { useAdvertisers } from '../api/advertisers'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { formatDate, formatCurrency } from '../lib/utils'
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
  const [editItem, setEditItem] = useState<Campaign | null>(null)
  const [formData, setFormData] = useState<CreateCampaign>({
    advertiser_id: '',
    name: '',
    start_date: '',
    end_date: '',
  })
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const createCampaign = useCreateCampaign()
  const updateCampaign = useUpdateCampaign(editItem?.id ?? '')
  const deleteCampaign = useDeleteCampaign()
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
    setEditItem(null)
    setFormData({
      advertiser_id: advertisers[0]?.id ?? '',
      name: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
    })
    setShowForm(true)
  }

  const openEdit = (c: Campaign) => {
    setEditItem(c)
    setFormData({
      advertiser_id: c.advertiser_id,
      name: c.name,
      start_date: c.start_date,
      end_date: c.end_date,
      budget: c.budget,
      notes: c.notes ?? undefined,
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    const mutation = editItem ? updateCampaign : createCampaign
    try {
      await mutation.mutateAsync(formData)
      toast.success(editItem ? 'Campaign updated' : 'Campaign created')
      setShowForm(false)
      setEditItem(null)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteCampaign.mutateAsync(deleteId)
      toast.success('Campaign deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  const CampaignCard = ({ campaign }: { campaign: Campaign }) => (
    <button
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      className="w-full bg-bg-primary border border-border-default rounded-lg p-3 text-left hover:border-border-hover transition-colors cursor-pointer"
    >
      <p className="text-sm font-medium text-text-primary truncate">{campaign.name}</p>
      <p className="text-xs text-text-secondary mt-1">{getAdvName(campaign.advertiser_id)}</p>
      <div className="flex items-center justify-between mt-1">
        <p className="text-xs text-text-muted">
          {formatDate(campaign.start_date)} - {formatDate(campaign.end_date)}
        </p>
        {campaign.budget != null && (
          <p className="text-xs text-text-secondary font-medium">{formatCurrency(campaign.budget)}</p>
        )}
      </div>
    </button>
  )

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-end mb-6">
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
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3 text-right">Actions</th>
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
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatCurrency(c.budget)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(c.id) }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-status-error" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditItem(null) }}
        title={editItem ? 'Edit Campaign' : 'New Campaign'}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setEditItem(null) }}>Cancel</Button>
            <Button onClick={handleSave} loading={editItem ? updateCampaign.isPending : createCampaign.isPending} disabled={!formData.name.trim()}>
              {editItem ? 'Save' : 'Create'}
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
          <Input
            label="Budget"
            type="number"
            value={formData.budget ?? ''}
            onChange={(e) => setFormData({ ...formData, budget: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="e.g. 10000"
          />
          <Textarea label="Notes" value={formData.notes ?? ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value || undefined })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Campaign"
        message="This will permanently delete this campaign and its creatives. Associated bookings will also be removed."
        confirmLabel="Delete"
        loading={deleteCampaign.isPending}
      />
    </div>
  )
}
