import { useState } from 'react'
import { ChevronRight, ChevronDown, MapPin, Plus, Pencil, Trash2 } from 'lucide-react'
import { useZones, useZone, useCreateZone, useUpdateZone, useDeleteZone } from '../api/zones'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { ZONE_TYPES } from '../lib/constants'
import { formatCurrency } from '../lib/utils'
import type { Zone, CreateZone } from '../types/api'

function ZoneNode({
  zone,
  zones,
  level,
  selectedId,
  onSelect,
}: {
  zone: Zone
  zones: Zone[]
  level: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(level === 0)
  const children = zones.filter((z) => z.parent_id === zone.id)
  const hasChildren = children.length > 0

  return (
    <div>
      <button
        onClick={() => {
          onSelect(zone.id)
          if (hasChildren) setExpanded(!expanded)
        }}
        className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
          selectedId === zone.id
            ? 'bg-accent/10 text-accent'
            : 'text-text-primary hover:bg-bg-elevated'
        }`}
        style={{ paddingLeft: `${level * 20 + 12}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
        <span className="truncate">{zone.name}</span>
        <Badge variant="default" className="ml-auto text-[10px]">{zone.zone_type}</Badge>
      </button>
      {expanded &&
        children.map((child) => (
          <ZoneNode
            key={child.id}
            zone={child}
            zones={zones}
            level={level + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

export default function Zones() {
  const { data: zones, isLoading } = useZones()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: zoneDetail } = useZone(selectedId ?? '')
  const [showForm, setShowForm] = useState(false)
  const [editZone, setEditZone] = useState<Zone | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateZone>({ name: '', zone_type: 'custom' })

  const createZone = useCreateZone()
  const updateZone = useUpdateZone(editZone?.id ?? '')
  const deleteZone = useDeleteZone()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const allZones = zones ?? []
  const rootZones = allZones.filter((z) => !z.parent_id)

  const openCreate = () => {
    setEditZone(null)
    setFormData({ name: '', zone_type: 'custom', parent_id: selectedId })
    setShowForm(true)
  }

  const openEdit = (zone: Zone) => {
    setEditZone(zone)
    setFormData({ name: zone.name, zone_type: zone.zone_type, parent_id: zone.parent_id, rate_per_slot: zone.rate_per_slot, currency: zone.currency ?? 'USD' })
    setShowForm(true)
  }

  const handleSave = () => {
    const mutation = editZone ? updateZone : createZone
    mutation.mutate(formData, {
      onSuccess: () => {
        toast.success(editZone ? 'Zone updated' : 'Zone created')
        setShowForm(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const wasSelected = selectedId === deleteId
    try {
      await deleteZone.mutateAsync(deleteId)
      toast.success('Zone deleted')
      if (wasSelected) setSelectedId(null)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Zones</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New Zone
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tree */}
        <Card title="Zone Hierarchy" className="lg:col-span-1" padding={false}>
          <div className="p-2">
            {rootZones.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No zones"
                description="Create zones to organize your boards geographically."
                action={{ label: 'New Zone', onClick: openCreate }}
              />
            ) : (
              rootZones.map((zone) => (
                <ZoneNode
                  key={zone.id}
                  zone={zone}
                  zones={allZones}
                  level={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))
            )}
          </div>
        </Card>

        {/* Detail */}
        <Card title={zoneDetail ? zoneDetail.name : 'Select a zone'} className="lg:col-span-2"
          action={
            zoneDetail ? (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(zoneDetail)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(zoneDetail.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-status-error" />
                </Button>
              </div>
            ) : undefined
          }
        >
          {zoneDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-text-muted text-xs mb-1">Type</p>
                  <Badge variant="accent">{zoneDetail.zone_type}</Badge>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Boards</p>
                  <p className="text-text-primary font-medium">{zoneDetail.board_count}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Rate per Slot</p>
                  <p className="text-text-primary font-medium">{formatCurrency(zoneDetail.rate_per_slot, zoneDetail.currency)}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Currency</p>
                  <p className="text-text-primary font-medium">{zoneDetail.currency ?? 'USD'}</p>
                </div>
              </div>
              {zoneDetail.children.length > 0 && (
                <div>
                  <p className="text-text-muted text-xs mb-2">Children</p>
                  <div className="space-y-1">
                    {zoneDetail.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => setSelectedId(child.id)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm text-text-primary hover:bg-bg-elevated cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5 text-text-muted" />
                        {child.name}
                        <Badge variant="default" className="ml-auto text-[10px]">{child.zone_type}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Click a zone in the tree to view details.</p>
          )}
        </Card>
      </div>

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editZone ? 'Edit Zone' : 'New Zone'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={createZone.isPending || updateZone.isPending}>
              {editZone ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Phnom Penh"
          />
          <Select
            label="Type"
            value={formData.zone_type ?? 'custom'}
            onChange={(e) => setFormData({ ...formData, zone_type: e.target.value })}
            options={ZONE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <Select
            label="Parent Zone"
            value={formData.parent_id ?? ''}
            onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
            options={allZones
              .filter((z) => z.id !== editZone?.id)
              .map((z) => ({ value: z.id, label: z.name }))}
            placeholder="None (root zone)"
          />
          <Input
            label="Rate per Slot"
            type="number"
            value={formData.rate_per_slot ?? ''}
            onChange={(e) => setFormData({ ...formData, rate_per_slot: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="e.g. 5.00"
          />
          <Input
            label="Currency"
            value={formData.currency ?? 'USD'}
            onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
            placeholder="USD"
          />
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Zone"
        message="Are you sure? Child zones will become root zones."
        loading={deleteZone.isPending}
      />
    </div>
  )
}
