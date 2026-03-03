import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Plus, Search, List, Map, Trash2, LayoutGrid,
  RefreshCw, Power, Cpu, HardDrive, Clock,
} from 'lucide-react'
import { useBoards, useCreateBoard, useDeleteBoard, useLiveStatus, usePingBoard, useBulkAction } from '../api/boards'
import { useZones } from '../api/zones'
import { useGroups } from '../api/groups'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatRelativeTime } from '../lib/utils'
import { BoardMap } from '../components/boards/BoardMap'
import { useBoardStatus } from '../hooks/useBoardStatus'
import type { Board, BoardLiveStatus } from '../types/api'

// ── Status helpers ──────────────────────────────────────────────────────

type DisplayStatus = 'playing' | 'idle' | 'degraded' | 'offline' | 'unknown'

function getDisplayStatus(board: Board, live?: BoardLiveStatus): DisplayStatus {
  if (!live) return board.status === 'online' ? 'idle' : 'offline'
  if (live.connectivity === 'offline') return 'offline'
  if (live.player_state === 'unreachable') return 'degraded'
  if (live.player_state === 'Playing') return 'playing'
  return 'idle'
}

const STATUS_CONFIG: Record<DisplayStatus, { dot: string; label: string; text: string }> = {
  playing: { dot: 'bg-emerald-500 animate-pulse', label: 'Playing', text: 'text-emerald-700 dark:text-emerald-400' },
  idle: { dot: 'bg-emerald-500', label: 'Idle', text: 'text-emerald-700 dark:text-emerald-400' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded', text: 'text-amber-700 dark:text-amber-400' },
  offline: { dot: 'bg-red-500', label: 'Offline', text: 'text-red-700 dark:text-red-400' },
  unknown: { dot: 'bg-gray-400', label: 'Unknown', text: 'text-gray-500' },
}

function StatusIndicator({ status }: { status: DisplayStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
    </div>
  )
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function CpuBar({ percent }: { percent: number }) {
  const color = percent >= 85 ? 'bg-red-500' : percent >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="text-[11px] text-text-muted font-mono">{percent.toFixed(0)}%</span>
    </div>
  )
}

function BoardThumbnail({ boardId, lastSeen, status, size = 'sm' }: {
  boardId: string
  lastSeen: string | null
  status: string
  size?: 'sm' | 'lg'
}) {
  const isOnline = status === 'online'
  const dims = size === 'sm' ? 'w-[120px] h-[68px]' : 'w-full aspect-video'

  return (
    <div className={`${dims} bg-black rounded overflow-hidden relative flex-shrink-0`}>
      {isOnline || lastSeen ? (
        <img
          src={`/api/boards/${boardId}/screenshot?t=${encodeURIComponent(lastSeen ?? '')}`}
          alt="Board preview"
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.currentTarget
            target.style.display = 'none'
            target.nextElementSibling?.classList.remove('hidden')
          }}
        />
      ) : null}
      <div className={`${isOnline && lastSeen ? 'hidden' : ''} absolute inset-0 flex flex-col items-center justify-center`}>
        <Monitor className={`${size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'} ${isOnline ? 'text-text-muted' : 'text-text-muted/50'}`} />
        <span className={`${size === 'sm' ? 'text-[10px]' : 'text-xs'} ${isOnline ? 'text-text-muted' : 'text-text-muted/50'} mt-0.5`}>
          {isOnline ? 'No preview' : 'Offline'}
        </span>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────

export default function Boards() {
  useBoardStatus()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterZone, setFilterZone] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'map'>('table')
  const [filterMode, setFilterMode] = useState<'all' | 'zone' | 'group' | 'type'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading } = useBoards({
    page,
    per_page: 50,
    zone_id: filterZone || undefined,
    status: filterStatus || undefined,
  })

  const { data: liveStatus } = useLiveStatus()
  const { data: zones } = useZones()
  const { data: groupsData } = useGroups({ per_page: 200 })
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  const createBoard = useCreateBoard()
  const deleteBoard = useDeleteBoard()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const toast = useToast()
  const pingBoard = usePingBoard()
  const bulkAction = useBulkAction()

  const boards = useMemo(() => {
    const all = data?.data ?? []
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter((b) => b.name.toLowerCase().includes(q))
  }, [data, search])

  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))
  const zoneList = zones ?? []
  const groups = groupsData?.data ?? []

  const getZoneName = (id: string | null) => zoneList.find((z) => z.id === id)?.name ?? '--'
  const getGroupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? '--'

  // Group boards for filter tabs
  const grouped = useMemo(() => {
    if (filterMode === 'zone') {
      const map: Record<string, Board[]> = {}
      for (const b of boards) {
        const key = b.zone_id ?? 'unassigned'
        ;(map[key] ??= []).push(b)
      }
      return map
    }
    if (filterMode === 'group') {
      const map: Record<string, Board[]> = {}
      for (const b of boards) {
        const key = b.group_id ?? 'unassigned'
        ;(map[key] ??= []).push(b)
      }
      return map
    }
    if (filterMode === 'type') {
      const map: Record<string, Board[]> = {}
      for (const b of boards) {
        const key = b.board_type ?? 'unassigned'
        ;(map[key] ??= []).push(b)
      }
      return map
    }
    return { all: boards }
  }, [boards, filterMode])

  if (isLoading) return <PageSpinner />

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === boards.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(boards.map((b) => b.id)))
    }
  }

  const handleCreate = async () => {
    try {
      await createBoard.mutateAsync({ name: newName, group_id: newGroupId || undefined })
      toast.success('Board created')
      setShowCreate(false)
      setNewName('')
      setNewGroupId('')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteBoard.mutateAsync(deleteId)
      toast.success('Board deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  const handlePing = async (boardId: string) => {
    try {
      const result = await pingBoard.mutateAsync(boardId)
      if (result.ok) toast.success(`Ping: ${result.latency_ms}ms`)
      else toast.error('Board unreachable')
    } catch {
      toast.error('Ping failed')
    }
  }

  const handleBulkAction = async (action: string) => {
    const ids = Array.from(selectedIds)
    try {
      const results = await bulkAction.mutateAsync({ board_ids: ids, action })
      const succeeded = Object.values(results).filter(Boolean).length
      toast.success(`${action}: ${succeeded}/${ids.length} succeeded`)
    } catch {
      toast.error(`Bulk ${action} failed`)
    }
  }

  const getGroupLabel = (key: string): string => {
    if (key === 'unassigned') return 'Unassigned'
    if (filterMode === 'zone') return getZoneName(key)
    if (filterMode === 'group') return getGroupName(key)
    return key.replace('_', ' ')
  }

  const renderBoardRow = (board: Board) => {
    const live = liveStatus?.[board.id]
    const status = getDisplayStatus(board, live)
    const metrics = live?.system_metrics

    return (
      <tr
        key={board.id}
        onClick={() => navigate(`/boards/${board.id}`)}
        className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors cursor-pointer"
      >
        <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(board.id)}
            onChange={() => toggleSelect(board.id)}
            className="rounded border-border-default accent-accent"
          />
        </td>
        <td className="px-2 py-2">
          <BoardThumbnail boardId={board.id} lastSeen={board.last_seen} status={board.status} />
        </td>
        <td className="px-3 py-2">
          <StatusIndicator status={status} />
        </td>
        <td className="px-3 py-2 text-text-primary font-medium">{board.name}</td>
        <td className="px-3 py-2 text-text-secondary text-xs truncate max-w-[140px]">
          {live?.current_item?.split('/').pop() ?? '--'}
        </td>
        <td className="px-3 py-2 text-text-secondary text-xs">{getZoneName(board.zone_id)}</td>
        <td className="px-3 py-2 text-text-secondary text-xs">{getGroupName(board.group_id)}</td>
        <td className="px-3 py-2">
          {metrics ? <CpuBar percent={metrics.cpu_percent} /> : <span className="text-xs text-text-muted">--</span>}
        </td>
        <td className="px-3 py-2 text-xs text-text-secondary font-mono">
          {metrics ? `${metrics.memory_used_mb}/${metrics.memory_total_mb}` : '--'}
        </td>
        <td className="px-3 py-2 text-xs text-text-secondary">
          {metrics ? formatUptime(metrics.uptime_secs) : '--'}
        </td>
        <td className="px-3 py-2 text-text-muted text-xs">{formatRelativeTime(board.last_seen)}</td>
        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          {status !== 'offline' ? (
            <button
              onClick={() => handlePing(board.id)}
              className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-accent transition-colors"
              title="Ping"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => handlePing(board.id)}
              className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-amber-500 transition-colors"
              title="Check status"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setDeleteId(board.id)}
            className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-status-error transition-colors ml-1"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    )
  }

  const renderTableSection = (sectionBoards: Board[], header?: string) => (
    <div key={header ?? 'all'}>
      {header && (
        <div className="px-4 py-2 bg-bg-primary border-b border-border-default">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{header}</span>
          <span className="text-xs text-text-muted ml-2">({sectionBoards.length})</span>
        </div>
      )}
      {sectionBoards.map(renderBoardRow)}
    </div>
  )

  const renderCardView = (cardBoards: Board[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {cardBoards.map((board) => {
        const live = liveStatus?.[board.id]
        const status = getDisplayStatus(board, live)
        const cfg = STATUS_CONFIG[status]

        return (
          <div
            key={board.id}
            onClick={() => navigate(`/boards/${board.id}`)}
            className="bg-bg-surface border border-border-default rounded-lg overflow-hidden hover:border-accent/50 transition-colors cursor-pointer group relative"
          >
            {/* Status stripe */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.dot.split(' ')[0]}`} />

            {/* Checkbox */}
            <div className="absolute top-2 left-3 z-10" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedIds.has(board.id)}
                onChange={() => toggleSelect(board.id)}
                className="rounded border-border-default accent-accent"
              />
            </div>

            <div className="relative">
              <BoardThumbnail boardId={board.id} lastSeen={board.last_seen} status={board.status} size="lg" />
              <div className="absolute top-2 right-2">
                <StatusIndicator status={status} />
              </div>
            </div>
            <div className="p-3 pl-4">
              <h3 className="text-sm font-medium text-text-primary truncate">{board.name}</h3>
              <p className="text-xs text-text-muted truncate">{getZoneName(board.zone_id)}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-text-muted">{formatRelativeTime(board.last_seen)}</span>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handlePing(board.id)}
                    className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                    title="Ping"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setDeleteId(board.id)}
                    className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-status-error transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Boards</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-bg-surface border border-border-default rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 transition-colors ${
                viewMode === 'table'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-1.5 transition-colors ${
                viewMode === 'cards'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
              title="Card view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`p-1.5 transition-colors ${
                viewMode === 'map'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
              title="Map view"
            >
              <Map className="w-4 h-4" />
            </button>
          </div>
          <Button onClick={() => { setNewName(''); setNewGroupId(''); setShowCreate(true) }} size="sm">
            <Plus className="w-4 h-4" /> New Board
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-bg-surface border border-border-default rounded-lg p-1">
          {(['all', 'zone', 'group', 'type'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filterMode === mode
                  ? 'bg-bg-primary shadow-sm font-medium text-text-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {mode === 'all' ? 'All' : mode === 'zone' ? 'By Zone' : mode === 'group' ? 'By Group' : 'By Type'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search boards..."
              className="w-full bg-bg-surface border border-border-default rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <Select
            value={filterZone}
            onChange={(e) => { setFilterZone(e.target.value); setPage(1) }}
            options={zoneList.map((z) => ({ value: z.id, label: z.name }))}
            placeholder="All Zones"
            className="w-36"
          />
          <Select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
            options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]}
            placeholder="All Status"
            className="w-32"
          />
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 mb-4 bg-accent/5 border border-accent/20 rounded-lg">
          <span className="text-sm font-medium text-text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction('ping')} loading={bulkAction.isPending}>
              <RefreshCw className="w-3 h-3" /> Ping All
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction('restart_agent')} loading={bulkAction.isPending}>
              <Power className="w-3 h-3" /> Restart Agent
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction('restart_player')} loading={bulkAction.isPending}>
              <Power className="w-3 h-3" /> Restart Player
            </Button>
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Deselect
          </Button>
        </div>
      )}

      {viewMode === 'map' ? (
        <BoardMap
          boards={boards}
          zones={zoneList}
          onBoardClick={(id) => navigate(`/boards/${id}`)}
        />
      ) : boards.length === 0 && !search ? (
        <EmptyState
          icon={Monitor}
          title="No boards"
          description="Boards appear here when agents connect to the server."
        />
      ) : boards.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No boards match your search.</p>
      ) : viewMode === 'cards' ? (
        <>
          {filterMode === 'all'
            ? renderCardView(boards)
            : Object.entries(grouped).map(([key, sectionBoards]) => (
                <div key={key} className="mb-6">
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                    {getGroupLabel(key)} <span className="text-text-muted font-normal">({sectionBoards.length})</span>
                  </h3>
                  {renderCardView(sectionBoards)}
                </div>
              ))}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      ) : (
        <>
          <Card padding={false}>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                  <th className="px-2 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={boards.length > 0 && selectedIds.size === boards.length}
                      onChange={toggleSelectAll}
                      className="rounded border-border-default accent-accent"
                    />
                  </th>
                  <th className="px-2 py-3 w-[136px]">Preview</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Content</th>
                  <th className="px-3 py-3">Zone</th>
                  <th className="px-3 py-3">Group</th>
                  <th className="px-3 py-3">
                    <div className="flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</div>
                  </th>
                  <th className="px-3 py-3">
                    <div className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> Mem</div>
                  </th>
                  <th className="px-3 py-3">
                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> Uptime</div>
                  </th>
                  <th className="px-3 py-3">Last Seen</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {filterMode === 'all'
                  ? boards.map(renderBoardRow)
                  : Object.entries(grouped).map(([key, sectionBoards]) =>
                      renderTableSection(sectionBoards, getGroupLabel(key))
                    )}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Board"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={createBoard.isPending} disabled={!newName.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Board Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. BKK-001" autoFocus />
          <Select
            label="Group (optional)"
            value={newGroupId}
            onChange={(e) => setNewGroupId(e.target.value)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="No group"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Board"
        message="This will permanently delete this board and its play logs."
        confirmLabel="Delete"
        loading={deleteBoard.isPending}
      />
    </div>
  )
}
