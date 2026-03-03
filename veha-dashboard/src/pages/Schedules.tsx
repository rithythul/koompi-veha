import { useState } from 'react'
import { Clock, Plus, Pencil, Trash2 } from 'lucide-react'
import { useSchedules, useCreateSchedule, useUpdateSchedule, useDeleteSchedule } from '../api/schedules'
import { useBoards } from '../api/boards'
import { useGroups } from '../api/groups'
import { usePlaylists } from '../api/playlists'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { getDaysOfWeekLabels } from '../lib/utils'
import { DAYS_OF_WEEK } from '../lib/constants'
import type { CreateSchedule, Schedule } from '../types/api'

export default function Schedules() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useSchedules({ page, per_page: 50 })
  const { data: boardsData } = useBoards({ per_page: 200 })
  const { data: groupsData } = useGroups({ per_page: 200 })
  const { data: playlistsData } = usePlaylists({ per_page: 200 })
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Schedule | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateSchedule>({ playlist_id: '' })
  const [targetType, setTargetType] = useState<'board' | 'group'>('board')
  const [selectedDays, setSelectedDays] = useState<number[]>([0,1,2,3,4,5,6])

  const createSchedule = useCreateSchedule()
  const updateSchedule = useUpdateSchedule(editItem?.id ?? '')
  const deleteSchedule = useDeleteSchedule()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const schedules = data?.data ?? []
  const boards = boardsData?.data ?? []
  const groups = groupsData?.data ?? []
  const playlists = playlistsData?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const getBoardName = (id: string | null) => boards.find((b) => b.id === id)?.name ?? id ?? '--'
  const getGroupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? id ?? '--'
  const getPlaylistName = (id: string) => playlists.find((p) => p.id === id)?.name ?? id

  const openCreate = () => {
    setEditItem(null)
    setFormData({ playlist_id: playlists[0]?.id ?? '' })
    setTargetType('board')
    setSelectedDays([0,1,2,3,4,5,6])
    setShowForm(true)
  }

  const openEdit = (s: Schedule) => {
    setEditItem(s)
    setFormData({
      board_id: s.board_id ?? undefined,
      group_id: s.group_id ?? undefined,
      playlist_id: s.playlist_id,
      start_time: s.start_time ?? undefined,
      end_time: s.end_time ?? undefined,
      priority: s.priority,
    })
    setTargetType(s.board_id ? 'board' : 'group')
    setSelectedDays(s.days_of_week ? s.days_of_week.split(',').map(Number) : [0,1,2,3,4,5,6])
    setShowForm(true)
  }

  const handleSave = async () => {
    const payload: CreateSchedule = {
      ...formData,
      days_of_week: selectedDays.sort().join(','),
    }
    if (targetType === 'board') delete payload.group_id
    else delete payload.board_id
    const mutation = editItem ? updateSchedule : createSchedule
    try {
      await mutation.mutateAsync(payload)
      toast.success(editItem ? 'Schedule updated' : 'Schedule created')
      setShowForm(false)
      setEditItem(null)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteSchedule.mutateAsync(deleteId)
      toast.success('Schedule deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-end mb-6">
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No schedules"
          description="Schedules assign playlists to boards or groups at specific times."
          action={{ label: 'New Schedule', onClick: openCreate }}
        />
      ) : (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Playlist</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-3 text-text-primary">
                    {s.board_id ? getBoardName(s.board_id) : getGroupName(s.group_id)}
                    <Badge variant="default" className="ml-2 text-[10px]">
                      {s.board_id ? 'board' : 'group'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{getPlaylistName(s.playlist_id)}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {s.start_time && s.end_time ? `${s.start_time} - ${s.end_time}` : 'All day'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{getDaysOfWeekLabels(s.days_of_week)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="accent">{s.priority}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(s.id)}>
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
        onClose={() => { setShowForm(false); setEditItem(null) }}
        title={editItem ? 'Edit Schedule' : 'New Schedule'}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setEditItem(null) }}>Cancel</Button>
            <Button onClick={handleSave} loading={editItem ? updateSchedule.isPending : createSchedule.isPending}>
              {editItem ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Target Type"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as 'board' | 'group')}
            options={[{ value: 'board', label: 'Board' }, { value: 'group', label: 'Group' }]}
          />
          {targetType === 'board' ? (
            <Select
              label="Board"
              value={formData.board_id ?? ''}
              onChange={(e) => setFormData({ ...formData, board_id: e.target.value, group_id: undefined })}
              options={boards.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select board"
            />
          ) : (
            <Select
              label="Group"
              value={formData.group_id ?? ''}
              onChange={(e) => setFormData({ ...formData, group_id: e.target.value, board_id: undefined })}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="Select group"
            />
          )}
          <Select
            label="Playlist"
            value={formData.playlist_id}
            onChange={(e) => setFormData({ ...formData, playlist_id: e.target.value })}
            options={playlists.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select playlist"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Start Time"
              type="time"
              value={formData.start_time ?? ''}
              onChange={(e) => setFormData({ ...formData, start_time: e.target.value || undefined })}
            />
            <Input
              label="End Time"
              type="time"
              value={formData.end_time ?? ''}
              onChange={(e) => setFormData({ ...formData, end_time: e.target.value || undefined })}
            />
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
          <Input
            label="Priority"
            type="number"
            value={formData.priority ?? 0}
            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Schedule"
        message="Are you sure you want to delete this schedule?"
        loading={deleteSchedule.isPending}
      />
    </div>
  )
}
