import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Square, SkipForward, SkipBack, RotateCcw, Monitor, Pencil } from 'lucide-react'
import { useBoard, useUpdateBoard, useSendBoardCommand, useBoardResolvedSchedule } from '../api/boards'
import { usePlayLogs } from '../api/playlogs'
import { useZones } from '../api/zones'
import { useGroups } from '../api/groups'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { formatRelativeTime, formatDateTime, formatDuration } from '../lib/utils'
import { SELL_MODES } from '../lib/constants'
import type { PlayerCommand, UpdateBoard } from '../types/api'

export default function BoardDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: board, isLoading } = useBoard(id ?? '')
  const { data: schedule } = useBoardResolvedSchedule(id ?? '')
  const { data: logsData } = usePlayLogs({ board_id: id, per_page: 10 })
  const { data: zones } = useZones()
  const { data: groupsData } = useGroups({ per_page: 200 })
  const sendCommand = useSendBoardCommand(id ?? '')
  const updateBoard = useUpdateBoard(id ?? '')
  const toast = useToast()
  const [showEdit, setShowEdit] = useState(false)
  const [editData, setEditData] = useState<UpdateBoard>({})

  if (isLoading || !board) return <PageSpinner />

  const zoneList = zones ?? []
  const groupList = groupsData?.data ?? []
  const zoneName = zoneList.find((z) => z.id === board.zone_id)?.name ?? '--'
  const groupName = groupList.find((g) => g.id === board.group_id)?.name ?? '--'
  const isOnline = board.status === 'online'
  const logs = logsData?.data ?? []
  const resolvedItems = schedule?.items ?? []

  const handleCommand = async (command: PlayerCommand) => {
    try {
      await sendCommand.mutateAsync(command)
      toast.success(`Command sent: ${command.type}`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const openEdit = () => {
    setEditData({
      name: board.name,
      zone_id: board.zone_id,
      group_id: board.group_id,
      address: board.address,
      sell_mode: board.sell_mode ?? '',
      orientation: board.orientation ?? '',
      operating_hours_start: board.operating_hours_start,
      operating_hours_end: board.operating_hours_end,
      latitude: board.latitude,
      longitude: board.longitude,
    })
    setShowEdit(true)
  }

  const handleSaveBoard = async () => {
    try {
      await updateBoard.mutateAsync(editData)
      toast.success('Board updated')
      setShowEdit(false)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const cmdBtn = (label: string, icon: React.ReactNode, command: PlayerCommand) => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => handleCommand(command)}
      disabled={!isOnline || sendCommand.isPending}
      title={label}
    >
      {icon}
    </Button>
  )

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate('/boards')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Boards
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-accent/15 rounded-lg flex items-center justify-center">
          <Monitor className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{board.name}</h1>
          <p className="text-xs text-text-muted font-mono">{board.id}</p>
        </div>
        <Badge variant={isOnline ? 'online' : 'offline'} dot className="ml-2">
          {board.status}
        </Badge>
        <Button variant="secondary" size="sm" onClick={openEdit} className="ml-auto">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Board Info */}
          <Card title="Board Info">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-text-muted text-xs mb-1">Zone</p>
                <p className="text-text-primary">{zoneName}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Group</p>
                <p className="text-text-primary">{groupName}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Sell Mode</p>
                <p className="text-text-primary capitalize">{board.sell_mode?.replace('_', ' ') ?? '--'}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Resolution</p>
                <p className="text-text-primary font-mono text-xs">
                  {board.screen_width && board.screen_height ? `${board.screen_width}x${board.screen_height}` : '--'}
                </p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Orientation</p>
                <p className="text-text-primary capitalize">{board.orientation ?? '--'}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Board Type</p>
                <p className="text-text-primary capitalize">{board.board_type?.replace('_', ' ') ?? '--'}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Address</p>
                <p className="text-text-primary">{board.address ?? '--'}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Last Seen</p>
                <p className="text-text-primary">{formatRelativeTime(board.last_seen)}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Operating Hours</p>
                <p className="text-text-primary">
                  {board.operating_hours_start && board.operating_hours_end
                    ? `${board.operating_hours_start} - ${board.operating_hours_end}`
                    : '24/7'}
                </p>
              </div>
            </div>
          </Card>

          {/* Player Controls */}
          <Card title="Player Controls">
            <div className="flex items-center gap-2">
              {cmdBtn('Play', <Play className="w-4 h-4" />, { type: 'Play' })}
              {cmdBtn('Pause', <Pause className="w-4 h-4" />, { type: 'Pause' })}
              {cmdBtn('Resume', <RotateCcw className="w-4 h-4" />, { type: 'Resume' })}
              {cmdBtn('Stop', <Square className="w-4 h-4" />, { type: 'Stop' })}
              <div className="w-px h-6 bg-border-default mx-1" />
              {cmdBtn('Previous', <SkipBack className="w-4 h-4" />, { type: 'Previous' })}
              {cmdBtn('Next', <SkipForward className="w-4 h-4" />, { type: 'Next' })}
            </div>
            {!isOnline && (
              <p className="text-xs text-text-muted mt-2">Board is offline. Commands cannot be sent.</p>
            )}
          </Card>

          {/* Resolved Schedule */}
          <Card title={`Resolved Schedule (${resolvedItems.length} items)`}>
            {resolvedItems.length === 0 ? (
              <p className="text-sm text-text-muted">No active schedule for this board.</p>
            ) : (
              <div className="space-y-1">
                {resolvedItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 rounded-md bg-bg-primary text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted text-xs w-6 text-right">{i + 1}</span>
                      <span className="text-text-primary">{item.name ?? item.source.split('/').pop()}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {item.duration_secs && (
                        <span className="text-text-muted text-xs">{item.duration_secs}s</span>
                      )}
                      {item.booking_id && (
                        <Badge variant="accent" className="text-[10px]">booking</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right column — Recent Play Logs */}
        <div>
          <Card title="Recent Play Logs">
            {logs.length === 0 ? (
              <p className="text-sm text-text-muted">No play logs yet.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="px-3 py-2 rounded-md bg-bg-primary text-sm">
                    <div className="flex items-center justify-between">
                      <Badge variant="online" className="text-[10px]">{log.status}</Badge>
                      <span className="text-text-muted text-xs">
                        {log.duration_secs ? formatDuration(log.duration_secs) : '--'}
                      </span>
                    </div>
                    <p className="text-text-muted text-xs mt-1">{formatDateTime(log.started_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Edit Board Modal */}
      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit Board"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSaveBoard} loading={updateBoard.isPending}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={editData.name ?? ''}
            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
          />
          <Select
            label="Zone"
            value={editData.zone_id ?? ''}
            onChange={(e) => setEditData({ ...editData, zone_id: e.target.value || null })}
            options={zoneList.map((z) => ({ value: z.id, label: z.name }))}
            placeholder="No zone"
          />
          <Select
            label="Group"
            value={editData.group_id ?? ''}
            onChange={(e) => setEditData({ ...editData, group_id: e.target.value || null })}
            options={groupList.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="No group"
          />
          <Input
            label="Address"
            value={editData.address ?? ''}
            onChange={(e) => setEditData({ ...editData, address: e.target.value || null })}
          />
          <Select
            label="Sell Mode"
            value={editData.sell_mode ?? ''}
            onChange={(e) => setEditData({ ...editData, sell_mode: e.target.value })}
            options={SELL_MODES.map((s) => ({ value: s.value, label: s.label }))}
            placeholder="Select mode"
          />
          <Select
            label="Orientation"
            value={editData.orientation ?? ''}
            onChange={(e) => setEditData({ ...editData, orientation: e.target.value })}
            options={[
              { value: 'landscape', label: 'Landscape' },
              { value: 'portrait', label: 'Portrait' },
            ]}
            placeholder="Select orientation"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Latitude"
              type="number"
              value={editData.latitude ?? ''}
              onChange={(e) => setEditData({ ...editData, latitude: e.target.value ? parseFloat(e.target.value) : null })}
            />
            <Input
              label="Longitude"
              type="number"
              value={editData.longitude ?? ''}
              onChange={(e) => setEditData({ ...editData, longitude: e.target.value ? parseFloat(e.target.value) : null })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Operating Start"
              type="time"
              value={editData.operating_hours_start ?? ''}
              onChange={(e) => setEditData({ ...editData, operating_hours_start: e.target.value || null })}
            />
            <Input
              label="Operating End"
              type="time"
              value={editData.operating_hours_end ?? ''}
              onChange={(e) => setEditData({ ...editData, operating_hours_end: e.target.value || null })}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
