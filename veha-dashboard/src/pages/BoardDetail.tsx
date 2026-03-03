import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Pause, SkipForward, SkipBack, Monitor, Pencil, Camera, Film, Radio, TerminalSquare, RefreshCw, Power, Cpu, HardDrive, Thermometer, Clock, CalendarClock } from 'lucide-react'

const BoardTerminal = lazy(() => import('../components/boards/BoardTerminal'))
import { useBoard, useUpdateBoard, useSendBoardCommand, useBoardResolvedSchedule, useBoardScreenshotMeta, useBoardScreenshots, useLiveStatus, usePingBoard, useRestartAgent, useRestartPlayer } from '../api/boards'
import { usePlayLogs } from '../api/playlogs'
import { useZones } from '../api/zones'
import { useGroups } from '../api/groups'
import { BoardScheduleTimeline } from '../components/boards/BoardScheduleTimeline'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { PageSpinner } from '../components/ui/Spinner'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
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
  const { data: screenshotMeta } = useBoardScreenshotMeta(id ?? '')
  const { data: screenshotsData } = useBoardScreenshots(id ?? '')
  const sendCommand = useSendBoardCommand(id ?? '')
  const updateBoard = useUpdateBoard(id ?? '')
  const { data: liveStatusMap } = useLiveStatus()
  const pingMutation = usePingBoard()
  const restartAgentMutation = useRestartAgent()
  const restartPlayerMutation = useRestartPlayer()
  const toast = useToast()
  const [pingResult, setPingResult] = useState<string | null>(null)
  const [restartTarget, setRestartTarget] = useState<'agent' | 'player' | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editData, setEditData] = useState<UpdateBoard>({})
  const [showTerminal, setShowTerminal] = useState(false)
  const [playerState, setPlayerState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [showControls, setShowControls] = useState(false)
  const [timelapseMode, setTimelapseMode] = useState(false)
  const [timelapseIndex, setTimelapseIndex] = useState(0)
  const [timelapsePlaying, setTimelapsePlaying] = useState(false)
  const timelapseTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [screenshotKey, setScreenshotKey] = useState(0)

  // Timelapse: screenshots ordered oldest-first for slider
  const timelapseFrames = [...(screenshotsData?.screenshots ?? [])].reverse()
  const totalFrames = timelapseFrames.length

  const stopTimelapse = useCallback(() => {
    setTimelapsePlaying(false)
    if (timelapseTimer.current) {
      clearInterval(timelapseTimer.current)
      timelapseTimer.current = null
    }
  }, [])

  const startTimelapse = useCallback(() => {
    if (totalFrames < 2) return
    setTimelapsePlaying(true)
    timelapseTimer.current = setInterval(() => {
      setTimelapseIndex((prev) => {
        if (prev >= totalFrames - 1) {
          stopTimelapse()
          return prev
        }
        return prev + 1
      })
    }, 500)
  }, [totalFrames, stopTimelapse])

  // Auto-refresh: bump screenshotKey when screenshotMeta changes
  useEffect(() => {
    if (screenshotMeta?.timestamp) {
      setScreenshotKey((k) => k + 1)
    }
  }, [screenshotMeta?.timestamp])

  useEffect(() => {
    return () => {
      if (timelapseTimer.current) clearInterval(timelapseTimer.current)
    }
  }, [])

  useEffect(() => {
    if (timelapseMode && totalFrames > 0) {
      setTimelapseIndex(0)
    }
  }, [timelapseMode, totalFrames])

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
      // Track player state locally for toggle behavior
      if (command.type === 'Play' || command.type === 'Resume') setPlayerState('playing')
      else if (command.type === 'Pause') setPlayerState('paused')
      else if (command.type === 'Stop') setPlayerState('idle')
      else if (command.type === 'Next' || command.type === 'Previous') setPlayerState('playing')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const togglePlayPause = () => {
    if (playerState === 'playing') handleCommand({ type: 'Pause' })
    else if (playerState === 'paused') handleCommand({ type: 'Resume' })
    else handleCommand({ type: 'Play' })
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

  const live = liveStatusMap?.[id ?? '']
  const metrics = live?.system_metrics

  const handlePing = async () => {
    if (!id) return
    try {
      const result = await pingMutation.mutateAsync(id)
      setPingResult(result.ok ? `${result.latency_ms}ms` : 'Unreachable')
      setTimeout(() => setPingResult(null), 5000)
    } catch {
      setPingResult('Failed')
      setTimeout(() => setPingResult(null), 5000)
    }
  }

  const handleRestart = async () => {
    if (!id || !restartTarget) return
    try {
      if (restartTarget === 'agent') await restartAgentMutation.mutateAsync(id)
      else await restartPlayerMutation.mutateAsync(id)
      toast.success(`Restart ${restartTarget} command sent`)
    } catch {
      toast.error(`Failed to restart ${restartTarget}`)
    } finally {
      setRestartTarget(null)
    }
  }

  const formatUptime = (secs: number) => {
    const d = Math.floor(secs / 86400)
    const h = Math.floor((secs % 86400) / 3600)
    if (d > 0) return `${d}d ${h}h`
    const m = Math.floor((secs % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

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
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowTerminal(!showTerminal)}
            disabled={!isOnline}
            title={isOnline ? 'Open remote terminal' : 'Board must be online'}
          >
            <TerminalSquare className="w-3.5 h-3.5" /> Terminal
          </Button>
          <Button variant="secondary" size="sm" onClick={openEdit}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
        </div>
      </div>

      {/* Remote Terminal Overlay */}
      {showTerminal && id && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="text-[#484f58] text-sm">Loading terminal...</div>
          </div>
        }>
          <BoardTerminal boardId={id} onClose={() => setShowTerminal(false)} />
        </Suspense>
      )}

      {/* Status Hero */}
      <Card padding={false} className="mb-4">
        <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              !live || live.connectivity === 'offline' ? 'bg-red-500'
              : live.player_state === 'Playing' ? 'bg-emerald-500 animate-pulse'
              : live.player_state === 'unreachable' ? 'bg-amber-500'
              : 'bg-emerald-500'
            }`} />
            <span className="text-sm font-medium text-text-primary">
              {!live ? (isOnline ? 'Connected' : 'Offline')
               : live.connectivity === 'offline' ? 'Offline'
               : live.player_state === 'Playing' ? `Playing: ${live.current_item?.split('/').pop() ?? 'media'}`
               : live.player_state === 'unreachable' ? 'Degraded — player unreachable'
               : `${live.player_state}`}
            </span>
            {live?.playlist_name && (
              <span className="text-xs text-text-muted">({live.playlist_name})</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePing}
              loading={pingMutation.isPending}
              disabled={!isOnline}
            >
              <RefreshCw className="w-3 h-3" />
              {pingResult ? pingResult : 'Ping'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRestartTarget('agent')}
              disabled={!isOnline}
            >
              <Power className="w-3 h-3" /> Restart Agent
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRestartTarget('player')}
              disabled={!isOnline}
            >
              <Power className="w-3 h-3" /> Restart Player
            </Button>
          </div>
        </div>
        {/* Metrics row */}
        {metrics && (
          <div className="px-4 py-3 flex items-center gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-text-muted" />
              <div className="w-16 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${metrics.cpu_percent >= 85 ? 'bg-red-500' : metrics.cpu_percent >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(metrics.cpu_percent, 100)}%` }}
                />
              </div>
              <span className="text-text-secondary font-mono">{metrics.cpu_percent.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-text-secondary font-mono">{metrics.memory_used_mb}/{metrics.memory_total_mb} MB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-text-secondary font-mono">{metrics.disk_used_gb.toFixed(1)}/{metrics.disk_total_gb.toFixed(1)} GB</span>
            </div>
            {metrics.temperature_celsius != null && (
              <div className="flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-text-muted" />
                <span className={`font-mono ${metrics.temperature_celsius >= 70 ? 'text-red-500' : 'text-text-secondary'}`}>
                  {metrics.temperature_celsius.toFixed(0)}&deg;C
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-text-secondary">{formatUptime(metrics.uptime_secs)}</span>
            </div>
            {metrics.agent_version && (
              <span className="text-text-muted ml-auto">v{metrics.agent_version}</span>
            )}
          </div>
        )}
      </Card>

      {/* Restart Confirmation Dialog */}
      <ConfirmDialog
        open={!!restartTarget}
        onClose={() => setRestartTarget(null)}
        onConfirm={handleRestart}
        title={`Restart ${restartTarget === 'agent' ? 'Agent' : 'Player'}`}
        message={`Are you sure you want to restart the ${restartTarget} on ${board.name}? The board may be temporarily unavailable.`}
        confirmLabel="Restart"
        loading={restartAgentMutation.isPending || restartPlayerMutation.isPending}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live Preview — merged screenshot + controls */}
          <Card
            title="Live Preview"
            action={
              screenshotMeta && totalFrames > 1 ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant={!timelapseMode ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => { stopTimelapse(); setTimelapseMode(false) }}
                    className="!py-0.5 !px-2 !text-[11px]"
                  >
                    <Radio className="w-3 h-3" /> Live
                  </Button>
                  <Button
                    variant={timelapseMode ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setTimelapseMode(true)}
                    className="!py-0.5 !px-2 !text-[11px]"
                  >
                    <Film className="w-3 h-3" /> Timelapse
                  </Button>
                </div>
              ) : undefined
            }
          >
            {/* Screenshot area */}
            {timelapseMode && totalFrames > 0 ? (
              <div>
                <div className="relative rounded-md overflow-hidden bg-black">
                  <img
                    src={timelapseFrames[timelapseIndex]?.url}
                    alt={`Screenshot frame ${timelapseIndex + 1}`}
                    className="w-full h-auto"
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {timelapsePlaying ? (
                      <Button variant="secondary" size="sm" onClick={stopTimelapse}>
                        <Pause className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={startTimelapse}
                        disabled={totalFrames < 2}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <input
                      type="range"
                      min={0}
                      max={totalFrames - 1}
                      value={timelapseIndex}
                      onChange={(e) => {
                        stopTimelapse()
                        setTimelapseIndex(Number(e.target.value))
                      }}
                      className="flex-1 accent-accent"
                    />
                    <span className="text-xs text-text-muted font-mono min-w-[4rem] text-right">
                      {timelapseIndex + 1} / {totalFrames}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">
                      {timelapseFrames[timelapseIndex]
                        ? formatRelativeTime(timelapseFrames[timelapseIndex].timestamp)
                        : '--'}
                    </span>
                    <span className="text-xs text-text-muted">
                      {screenshotMeta?.total_screenshots ?? totalFrames} stored
                    </span>
                  </div>
                </div>
              </div>
            ) : screenshotMeta ? (
              <div
                className="relative rounded-md overflow-hidden bg-black group/preview cursor-pointer"
                onMouseEnter={() => setShowControls(true)}
                onMouseLeave={() => setShowControls(false)}
                onClick={isOnline ? togglePlayPause : undefined}
              >
                <img
                  src={`/api/boards/${id}/screenshot?t=${encodeURIComponent(screenshotMeta.timestamp)}&k=${screenshotKey}`}
                  alt="Board screenshot"
                  className="w-full h-auto"
                />
                {/* Hover overlay with controls */}
                <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-opacity duration-200 ${showControls && isOnline ? 'opacity-100' : 'opacity-0'}`}>
                  {/* Center play/pause */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center transition-transform group-hover/preview:scale-110">
                      {playerState === 'playing'
                        ? <Pause className="w-7 h-7 text-white" />
                        : <Play className="w-7 h-7 text-white ml-1" />}
                    </div>
                  </div>
                  {/* Bottom bar */}
                  <div className="absolute bottom-0 inset-x-0 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCommand({ type: 'Previous' }) }}
                        disabled={sendCommand.isPending}
                        className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors disabled:opacity-40"
                        title="Previous"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCommand({ type: 'Next' }) }}
                        disabled={sendCommand.isPending}
                        className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors disabled:opacity-40"
                        title="Next"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCommand({ type: 'TakeScreenshot', data: `/tmp/veha-screenshot-${id}.jpg` }) }}
                      disabled={sendCommand.isPending}
                      className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors disabled:opacity-40"
                      title="Capture screenshot"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/* Offline overlay */}
                {!isOnline && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="text-white/80 text-sm font-medium">Board Offline</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="relative rounded-md overflow-hidden bg-black group/preview cursor-pointer"
                onMouseEnter={() => setShowControls(true)}
                onMouseLeave={() => setShowControls(false)}
                onClick={isOnline ? togglePlayPause : undefined}
              >
                <div className="aspect-video flex flex-col items-center justify-center">
                  <Monitor className="w-8 h-8 text-white/20 mb-2" />
                  <p className="text-sm text-white/40">
                    {isOnline ? 'No preview available' : 'Board Offline'}
                  </p>
                  {isOnline && (
                    <p className="text-xs text-white/25 mt-1">Assign a playlist to start</p>
                  )}
                </div>
                {/* Hover overlay */}
                {isOnline && (
                  <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
                      <Play className="w-7 h-7 text-white/70 ml-1" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Status line */}
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-text-muted">
                {screenshotMeta
                  ? <>Last updated: {formatRelativeTime(screenshotMeta.timestamp)}</>
                  : 'No screenshots yet'}
                {screenshotMeta?.total_screenshots != null && !timelapseMode && (
                  <> &middot; {screenshotMeta.total_screenshots} stored</>
                )}
              </span>
              {!isOnline && !timelapseMode && (
                <span className="text-xs text-text-muted">Offline</span>
              )}
            </div>
          </Card>

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

          {/* 24-hour Schedule Timeline */}
          <Card
            title="Time Slots"
            action={
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <CalendarClock className="w-3.5 h-3.5" />
                <span>24h schedule</span>
              </div>
            }
          >
            <BoardScheduleTimeline boardId={board.id} groupId={board.group_id} />
          </Card>

          {/* Resolved Schedule (what's currently queued) */}
          {resolvedItems.length > 0 && (
            <Card title={`Now Playing Queue (${resolvedItems.length} items)`}>
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
            </Card>
          )}
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
