import { useState } from 'react'
import { CalendarCheck, Plus, Pencil, Trash2 } from 'lucide-react'
import { useBookings, useCreateBooking, useUpdateBooking, useDeleteBooking } from '../api/bookings'
import { useCampaigns } from '../api/campaigns'
import { useBoards } from '../api/boards'
import { useZones } from '../api/zones'
import { useGroups } from '../api/groups'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatDate, getDaysOfWeekLabels, formatCurrency } from '../lib/utils'
import { BOOKING_TYPES, TARGET_TYPES, DAYS_OF_WEEK } from '../lib/constants'
import type { Booking, CreateBooking } from '../types/api'

const defaultForm: CreateBooking = {
  campaign_id: '',
  booking_type: 'rotation',
  target_type: 'board',
  target_id: '',
  start_date: '',
  end_date: '',
  days_of_week: '0,1,2,3,4,5,6',
  slot_duration_secs: 15,
  slots_per_loop: 1,
  priority: 0,
}

export default function Bookings() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useBookings({ page, per_page: 50 })
  const { data: campaignsData } = useCampaigns({ per_page: 200 })
  const { data: boardsData } = useBoards({ per_page: 200 })
  const { data: zones } = useZones()
  const { data: groupsData } = useGroups({ per_page: 200 })

  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Booking | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateBooking>(defaultForm)
  const [selectedDays, setSelectedDays] = useState<number[]>([0,1,2,3,4,5,6])

  const createBooking = useCreateBooking()
  const updateBooking = useUpdateBooking(editItem?.id ?? '')
  const deleteBooking = useDeleteBooking()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const bookings = data?.data ?? []
  const campaigns = campaignsData?.data ?? []
  const boards = boardsData?.data ?? []
  const zoneList = zones ?? []
  const groups = groupsData?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const getCampaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? id.slice(0, 8)
  const getTargetName = (type: string, id: string) => {
    if (type === 'board') return boards.find((b) => b.id === id)?.name ?? id.slice(0, 8)
    if (type === 'zone') return zoneList.find((z) => z.id === id)?.name ?? id.slice(0, 8)
    if (type === 'group') return groups.find((g) => g.id === id)?.name ?? id.slice(0, 8)
    return id.slice(0, 8)
  }

  const getTargetOptions = () => {
    if (formData.target_type === 'board') return boards.map((b) => ({ value: b.id, label: b.name }))
    if (formData.target_type === 'zone') return zoneList.map((z) => ({ value: z.id, label: z.name }))
    if (formData.target_type === 'group') return groups.map((g) => ({ value: g.id, label: g.name }))
    return []
  }

  const openCreate = () => {
    setEditItem(null)
    setFormData({ ...defaultForm, campaign_id: campaigns[0]?.id ?? '' })
    setSelectedDays([0,1,2,3,4,5,6])
    setShowForm(true)
  }

  const openEdit = (b: Booking) => {
    setEditItem(b)
    setFormData({
      campaign_id: b.campaign_id,
      booking_type: b.booking_type,
      target_type: b.target_type,
      target_id: b.target_id,
      start_date: b.start_date,
      end_date: b.end_date,
      start_time: b.start_time ?? undefined,
      end_time: b.end_time ?? undefined,
      days_of_week: b.days_of_week,
      slot_duration_secs: b.slot_duration_secs,
      slots_per_loop: b.slots_per_loop,
      priority: b.priority,
      notes: b.notes ?? undefined,
    })
    setSelectedDays(b.days_of_week.split(',').map((s) => parseInt(s.trim())))
    setShowForm(true)
  }

  const handleSave = () => {
    const payload: CreateBooking = { ...formData, days_of_week: selectedDays.sort().join(',') }
    const mutation = editItem ? updateBooking : createBooking
    mutation.mutate(payload, {
      onSuccess: () => {
        toast.success(editItem ? 'Booking updated' : 'Booking created')
        setShowForm(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = () => {
    if (!deleteId) return
    deleteBooking.mutate(deleteId, {
      onSuccess: () => {
        toast.success('Booking deleted')
        setDeleteId(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Bookings</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New Booking
        </Button>
      </div>

      {bookings.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No bookings"
          description="Create bookings to assign campaigns to boards or zones."
          action={{ label: 'New Booking', onClick: openCreate }}
        />
      ) : (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Cost/Slot</th>
                <th className="px-4 py-3">Est. Cost</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-3 text-text-primary font-medium">{getCampaignName(b.campaign_id)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={b.booking_type === 'exclusive' ? 'warning' : 'accent'}>
                      {b.booking_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {getTargetName(b.target_type, b.target_id)}
                    <Badge variant="default" className="ml-1.5 text-[10px]">{b.target_type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {formatDate(b.start_date)} - {formatDate(b.end_date)}
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">{getDaysOfWeekLabels(b.days_of_week)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="accent">{b.priority}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{formatCurrency(b.cost_per_slot)}</td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{formatCurrency(b.estimated_cost)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="online">{b.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(b.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-status-error" />
                      </Button>
                    </div>
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

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editItem ? 'Edit Booking' : 'New Booking'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={createBooking.isPending || updateBooking.isPending}>
              {editItem ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Campaign"
            value={formData.campaign_id}
            onChange={(e) => setFormData({ ...formData, campaign_id: e.target.value })}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select campaign"
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Booking Type"
              value={formData.booking_type}
              onChange={(e) => setFormData({ ...formData, booking_type: e.target.value })}
              options={BOOKING_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
            <Select
              label="Target Type"
              value={formData.target_type}
              onChange={(e) => setFormData({ ...formData, target_type: e.target.value, target_id: '' })}
              options={TARGET_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <Select
            label="Target"
            value={formData.target_id}
            onChange={(e) => setFormData({ ...formData, target_id: e.target.value })}
            options={getTargetOptions()}
            placeholder={`Select ${formData.target_type}`}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Date" type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
            <Input label="End Date" type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start Time (optional)" type="time" value={formData.start_time ?? ''} onChange={(e) => setFormData({ ...formData, start_time: e.target.value || undefined })} />
            <Input label="End Time (optional)" type="time" value={formData.end_time ?? ''} onChange={(e) => setFormData({ ...formData, end_time: e.target.value || undefined })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Days of Week</label>
            <div className="flex gap-1.5">
              {DAYS_OF_WEEK.map((d) => (
                <button
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  className={`w-9 h-8 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    selectedDays.includes(d.value)
                      ? 'bg-accent text-white'
                      : 'bg-bg-surface border border-border-default text-text-secondary hover:bg-bg-elevated'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Slot Duration (s)" type="number" min={1} value={formData.slot_duration_secs ?? 15} onChange={(e) => setFormData({ ...formData, slot_duration_secs: parseInt(e.target.value) || 15 })} />
            <Input label="Slots/Loop" type="number" min={1} value={formData.slots_per_loop ?? 1} onChange={(e) => setFormData({ ...formData, slots_per_loop: parseInt(e.target.value) || 1 })} />
            <Input label="Priority" type="number" value={formData.priority ?? 0} onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })} />
          </div>
          <Textarea label="Notes" value={formData.notes ?? ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value || undefined })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Booking"
        message="Are you sure you want to delete this booking?"
        loading={deleteBooking.isPending}
      />
    </div>
  )
}
