import { useState } from 'react'
import { Plus, Pencil, Trash2, Calendar } from 'lucide-react'
import { useSchedules, useCreateSchedule, useUpdateSchedule, useDeleteSchedule } from '../../api/schedules'
import { usePlaylists } from '../../api/playlists'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { cn } from '../../lib/utils'
import type { Schedule, CreateSchedule } from '../../types/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

// Parse days_of_week string ("0,1,2,3,4,5,6") to a Set of day numbers
function parseDays(s: string | null | undefined): Set<number> {
  if (!s) return new Set([0, 1, 2, 3, 4, 5, 6])
  return new Set(s.split(',').map(Number).filter((n) => !isNaN(n)))
}

function formatDaysShort(days: Set<number>): string {
  if (days.size === 7) return 'Every day'
  if (days.size === 0) return 'No days'
  const labels = [...days].sort().map((d) => DAYS[d])
  return labels.join(', ')
}

// Distinct colors per schedule slot
const SLOT_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
]

// ── Schedule Block ───────────────────────────────────────────────────────────

function ScheduleBlock({
  schedule,
  playlistName,
  color,
  leftPct,
  widthPct,
  isAllDay,
  onEdit,
  onDelete,
}: {
  schedule: Schedule
  playlistName: string
  color: string
  leftPct: number
  widthPct: number
  isAllDay: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const days = parseDays(schedule.days_of_week)
  const startLabel = schedule.start_time ? schedule.start_time.slice(0, 5) : '00:00'
  const endLabel = schedule.end_time ? schedule.end_time.slice(0, 5) : '24:00'
  const isGroup = !!schedule.group_id && !schedule.board_id

  return (
    <div
      className={cn(
        'absolute top-0.5 bottom-0.5 rounded-lg overflow-hidden cursor-pointer group/block',
        'flex flex-col justify-between p-1.5',
        color + '/80 hover:' + color,
        'transition-all select-none border border-white/10',
        isAllDay && 'opacity-60',
      )}
      style={isAllDay ? { left: 0, right: 0, top: '2px', bottom: '2px' } : { left: `${leftPct}%`, width: `${widthPct}%` }}
      title={`${playlistName}\n${startLabel} – ${endLabel}\n${formatDaysShort(days)}${isGroup ? '\n(group schedule)' : ''}`}
    >
      {/* Actions */}
      <div
        className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onEdit}
          className="p-0.5 rounded bg-black/30 text-white hover:bg-black/50 transition-colors cursor-pointer"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-0.5 rounded bg-black/30 text-white hover:bg-red-500/80 transition-colors cursor-pointer"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex items-center gap-1 min-w-0">
        {isGroup && <Calendar className="w-2.5 h-2.5 text-white/70 flex-shrink-0" />}
        <span className="text-[10px] font-medium text-white truncate drop-shadow-sm leading-tight">
          {playlistName}
        </span>
      </div>
      <span className="text-[10px] text-white/70 tabular-nums drop-shadow-sm">
        {isAllDay ? 'All day' : `${startLabel}–${endLabel}`}
      </span>
    </div>
  )
}

// ── Schedule Form ────────────────────────────────────────────────────────────

interface ScheduleForm {
  playlist_id: string
  start_time: string
  end_time: string
  days: Set<number>
  priority: number
  all_day: boolean
}

function ScheduleFormModal({
  open,
  onClose,
  onSave,
  loading,
  initial,
  playlists,
}: {
  open: boolean
  onClose: () => void
  onSave: (form: ScheduleForm) => void
  loading: boolean
  initial?: Partial<ScheduleForm>
  playlists: { id: string; name: string }[]
}) {
  const [form, setForm] = useState<ScheduleForm>(() => ({
    playlist_id: initial?.playlist_id ?? '',
    start_time: initial?.start_time ?? '08:00',
    end_time: initial?.end_time ?? '18:00',
    days: initial?.days ?? new Set([1, 2, 3, 4, 5]),
    priority: initial?.priority ?? 10,
    all_day: initial?.all_day ?? false,
  }))

  // Reset when opened with new initial values
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setLastOpen(true)
    setForm({
      playlist_id: initial?.playlist_id ?? '',
      start_time: initial?.start_time ?? '08:00',
      end_time: initial?.end_time ?? '18:00',
      days: initial?.days ?? new Set([1, 2, 3, 4, 5]),
      priority: initial?.priority ?? 10,
      all_day: initial?.all_day ?? false,
    })
  }
  if (!open && lastOpen) setLastOpen(false)

  const toggleDay = (day: number) => {
    setForm((prev) => {
      const next = new Set(prev.days)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return { ...prev, days: next }
    })
  }

  const canSave = form.playlist_id && (form.all_day || (form.start_time && form.end_time))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.playlist_id ? 'Edit Time Slot' : 'Add Time Slot'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)} loading={loading} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Playlist"
          value={form.playlist_id}
          onChange={(e) => setForm((p) => ({ ...p, playlist_id: e.target.value }))}
          options={playlists.map((pl) => ({ value: pl.id, label: pl.name }))}
          placeholder="Select a playlist"
        />

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.all_day}
            onChange={(e) => setForm((p) => ({ ...p, all_day: e.target.checked }))}
            className="accent-accent"
          />
          <span className="text-sm text-text-secondary">All day (no time restriction)</span>
        </label>

        {!form.all_day && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))}
                className="w-full bg-bg-elevated border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">End Time</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))}
                className="w-full bg-bg-elevated border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-text-muted mb-2">Days of Week</label>
          <div className="flex gap-1.5">
            {DAYS.map((day, i) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(i)}
                className={cn(
                  'flex-1 py-1 text-xs rounded-md transition-colors border cursor-pointer',
                  form.days.has(i)
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-elevated text-text-muted border-border-default hover:border-border-hover',
                )}
              >
                {day.slice(0, 1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Priority</label>
          <input
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={(e) => setForm((p) => ({ ...p, priority: parseInt(e.target.value) || 0 }))}
            className="w-24 bg-bg-elevated border border-border-default rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-text-muted mt-1">Higher = takes priority over lower values</p>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BoardScheduleTimeline({
  boardId,
  groupId,
}: {
  boardId: string
  groupId: string | null
}) {
  const toast = useToast()
  const [activeDay, setActiveDay] = useState<number>(new Date().getDay())
  const [showAdd, setShowAdd] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: schedulesData } = useSchedules({ per_page: 200 })
  const { data: playlistsData } = usePlaylists({ per_page: 200 })

  const createSchedule = useCreateSchedule()
  const updateSchedule = useUpdateSchedule(editSchedule?.id ?? '')
  const deleteSchedule = useDeleteSchedule()

  const allSchedules = schedulesData?.data ?? []
  const playlists = playlistsData?.data ?? []

  // Schedules that belong to this board or its group
  const boardSchedules = allSchedules.filter(
    (s) => s.board_id === boardId || (groupId && s.group_id === groupId && !s.board_id),
  )

  // Filter by active day
  const visibleSchedules = boardSchedules.filter((s) => {
    const days = parseDays(s.days_of_week)
    return days.has(activeDay)
  })

  const timedSlots = visibleSchedules.filter((s) => s.start_time)
  const allDaySlots = visibleSchedules.filter((s) => !s.start_time)

  const getPlaylistName = (id: string) => playlists.find((p) => p.id === id)?.name ?? 'Unknown'

  const handleSave = async (form: ScheduleForm) => {
    const payload: CreateSchedule = {
      board_id: boardId,
      playlist_id: form.playlist_id,
      days_of_week: [...form.days].sort().join(','),
      priority: form.priority,
    }
    if (!form.all_day) {
      payload.start_time = form.start_time + ':00'
      payload.end_time = form.end_time + ':00'
    }

    try {
      if (editSchedule) {
        await updateSchedule.mutateAsync(payload)
        toast.success('Time slot updated')
        setEditSchedule(null)
      } else {
        await createSchedule.mutateAsync(payload)
        toast.success('Time slot added')
        setShowAdd(false)
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteSchedule.mutateAsync(deleteId)
      toast.success('Time slot deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  const toEditForm = (s: Schedule): Partial<ScheduleForm> => ({
    playlist_id: s.playlist_id,
    start_time: s.start_time?.slice(0, 5) ?? '08:00',
    end_time: s.end_time?.slice(0, 5) ?? '18:00',
    days: parseDays(s.days_of_week),
    priority: s.priority,
    all_day: !s.start_time,
  })

  return (
    <div className="space-y-3">
      {/* Toolbar: day tabs + add button */}
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5 bg-bg-elevated rounded-lg p-0.5">
          {DAYS.map((day, i) => {
            const count = boardSchedules.filter((s) => parseDays(s.days_of_week).has(i)).length
            return (
              <button
                key={day}
                onClick={() => setActiveDay(i)}
                className={cn(
                  'px-2 py-1 text-xs rounded-md transition-colors relative cursor-pointer',
                  activeDay === i
                    ? 'bg-bg-surface shadow-sm font-medium text-text-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {day}
                {count > 0 && (
                  <span className={cn(
                    'absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full',
                    activeDay === i ? 'bg-accent' : 'bg-text-muted/50',
                  )} />
                )}
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Plus className="w-3.5 h-3.5" /> Add Time Slot
        </Button>
      </div>

      {/* 24-hour timeline */}
      <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
        {/* Hour markers */}
        <div className="relative px-2 pt-2 pb-0">
          <div className="relative h-4">
            {HOUR_LABELS.map((h) => (
              <span
                key={h}
                className="absolute text-[10px] text-text-muted -translate-x-1/2"
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {h.toString().padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>

        {/* Track */}
        <div className="relative px-2 pb-2">
          {/* All-day row */}
          {allDaySlots.length > 0 && (
            <div className="relative h-10 mb-1 rounded-md bg-bg-elevated overflow-hidden">
              {/* Grid lines */}
              {HOUR_LABELS.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-border-default/30"
                  style={{ left: `${(h / 24) * 100}%` }}
                />
              ))}
              {allDaySlots.map((s) => (
                <ScheduleBlock
                  key={s.id}
                  schedule={s}
                  playlistName={getPlaylistName(s.playlist_id)}
                  color={SLOT_COLORS[(boardSchedules.indexOf(s)) % SLOT_COLORS.length]}
                  leftPct={0}
                  widthPct={100}
                  isAllDay
                  onEdit={() => setEditSchedule(s)}
                  onDelete={() => setDeleteId(s.id)}
                />
              ))}
            </div>
          )}

          {/* Timed slots row */}
          <div className="relative h-16 rounded-md bg-bg-elevated overflow-hidden">
            {/* Grid lines */}
            {HOUR_LABELS.map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 border-l border-border-default/30"
                style={{ left: `${(h / 24) * 100}%` }}
              />
            ))}

            {timedSlots.length === 0 && allDaySlots.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-text-muted">No time slots for {DAYS[activeDay]}</span>
              </div>
            )}

            {timedSlots.map((s) => {
              const startMin = timeToMinutes(s.start_time) ?? 0
              const endMin = timeToMinutes(s.end_time) ?? 1440
              const leftPct = (startMin / 1440) * 100
              const widthPct = ((endMin - startMin) / 1440) * 100
              const colorIdx = boardSchedules.indexOf(s) % SLOT_COLORS.length

              return (
                <ScheduleBlock
                  key={s.id}
                  schedule={s}
                  playlistName={getPlaylistName(s.playlist_id)}
                  color={SLOT_COLORS[colorIdx]}
                  leftPct={leftPct}
                  widthPct={Math.max(widthPct, 1)}
                  isAllDay={false}
                  onEdit={() => setEditSchedule(s)}
                  onDelete={() => setDeleteId(s.id)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Schedule list */}
      {boardSchedules.length > 0 && (
        <div className="space-y-1">
          {boardSchedules
            .filter((s) => parseDays(s.days_of_week).has(activeDay))
            .sort((a, b) => b.priority - a.priority)
            .map((s) => {
              const colorIdx = boardSchedules.indexOf(s) % SLOT_COLORS.length
              const days = parseDays(s.days_of_week)
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-primary text-sm group hover:bg-bg-elevated transition-colors"
                >
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0', SLOT_COLORS[colorIdx])} />
                  <span className="text-text-primary font-medium truncate flex-1">
                    {getPlaylistName(s.playlist_id)}
                  </span>
                  <span className="text-xs text-text-muted tabular-nums">
                    {s.start_time ? `${s.start_time.slice(0, 5)} – ${s.end_time?.slice(0, 5) ?? '24:00'}` : 'All day'}
                  </span>
                  <span className="text-xs text-text-muted hidden sm:block">{formatDaysShort(days)}</span>
                  <span className="text-[11px] text-text-muted/60 w-8 text-right">P{s.priority}</span>
                  {!!s.group_id && !s.board_id && (
                    <span className="text-[10px] text-text-muted/60 italic">group</span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditSchedule(s)}
                      className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeleteId(s.id)}
                      className="p-1 rounded text-text-muted hover:text-status-error hover:bg-bg-elevated transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {boardSchedules.length === 0 && (
        <div className="text-center py-6 border border-dashed border-border-default rounded-lg">
          <p className="text-sm text-text-muted">No time slots configured.</p>
          <p className="text-xs text-text-muted/70 mt-1">
            Add time slots to control what plays at specific hours.
          </p>
        </div>
      )}

      {/* Add modal */}
      <ScheduleFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleSave}
        loading={createSchedule.isPending}
        playlists={playlists}
      />

      {/* Edit modal */}
      <ScheduleFormModal
        open={!!editSchedule}
        onClose={() => setEditSchedule(null)}
        onSave={handleSave}
        loading={updateSchedule.isPending}
        initial={editSchedule ? toEditForm(editSchedule) : undefined}
        playlists={playlists}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Time Slot"
        message="This schedule slot will be removed from this board."
        confirmLabel="Delete"
        loading={deleteSchedule.isPending}
      />
    </div>
  )
}
