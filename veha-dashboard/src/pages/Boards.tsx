import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Plus, Search, List, Map, Trash2, LayoutGrid,
  RefreshCw, Power, Pencil, Layers,
} from 'lucide-react'
import { useBoards, useCreateBoard, useDeleteBoard, useLiveStatus, usePingBoard, useBulkAction } from '../api/boards'
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup } from '../api/groups'
import { useZones } from '../api/zones'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { cn, formatRelativeTime } from '../lib/utils'
import { BoardMap } from '../components/boards/BoardMap'
import { useBoardStatus } from '../hooks/useBoardStatus'
import type { Board, BoardLiveStatus } from '../types/api'

// ── Status helpers ───────────────────────────────────────────────────────────

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

// ── Main component ───────────────────────────────────────────────────────────

export default function Boards() {
  useBoardStatus()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterZone, setFilterZone] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards' | 'map'>('table')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  // Board List (Group) CRUD state
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editGroupId, setEditGroupId] = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState('')
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null)

  const { data, isLoading } = useBoards({
    page,
    per_page: 50,
    zone_id: filterZone || undefined,
    status: filterStatus || undefined,
  })

  // Separate query for all boards (used for group membership stats)
  const { data: allBoardsData } = useBoards({ per_page: 500 })
  const allBoards = allBoardsData?.data ?? []

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

  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup(editGroupId ?? '')
  const deleteGroup = useDeleteGroup()

  const boards = useMemo(() => {
    const all = data?.data ?? []
    let result = all
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((b) => b.name.toLowerCase().includes(q))
    }
    if (selectedGroupId) {
      result = result.filter((b) => b.group_id === selectedGroupId)
    }
    return result
  }, [data, search, selectedGroupId])

  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))
  const zoneList = zones ?? []
  const groups = groupsData?.data ?? []

  const getZoneName = (id: string | null) => zoneList.find((z) => z.id === id)?.name ?? '--'

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
      await createBoard.mutateAsync({
        name: newName,
        group_id: newGroupId || undefined,
      })
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    try {
      await createGroup.mutateAsync({ name: newGroupName.trim() })
      toast.success('Board list created')
      setShowCreateGroup(false)
      setNewGroupName('')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleEditGroup = async () => {
    if (!editGroupId || !editGroupName.trim()) return
    try {
      await updateGroup.mutateAsync({ name: editGroupName.trim() })
      toast.success('Board list renamed')
      setEditGroupId(null)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDeleteGroup = async () => {
    if (!deleteGroupId) return
    try {
      await deleteGroup.mutateAsync(deleteGroupId)
      toast.success('Board list deleted')
      if (selectedGroupId === deleteGroupId) setSelectedGroupId(null)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteGroupId(null)
    }
  }

  const renderBoardRow = (board: Board) => {
    const live = liveStatus?.[board.id]
    const status = getDisplayStatus(board, live)
    const metrics = live?.system_metrics

    return (
      <tr
        key={board.id}
        onClick={() => navigate(`/boards/${board.id}`)}
        className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors cursor-pointer group"
      >
        <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
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
        <td className="px-3 py-2">
          <p className="text-sm font-medium text-text-primary truncate">{board.name}</p>
        </td>
        <td className="px-3 py-2 text-xs text-text-secondary truncate max-w-[140px]">
          {live?.current_item?.split('/').pop() ?? '--'}
        </td>
        <td className="px-3 py-2 text-xs text-text-secondary">{getZoneName(board.zone_id)}</td>
        <td className="px-3 py-2 text-xs text-text-muted font-mono">
          {metrics ? `${metrics.cpu_percent.toFixed(0)}%` : '--'}
        </td>
        <td className="px-3 py-2 text-xs text-text-muted font-mono">
          {metrics ? `${metrics.memory_used_mb}/${metrics.memory_total_mb}` : '--'}
        </td>
        <td className="px-3 py-2 text-xs text-text-muted">{formatRelativeTime(board.last_seen)}</td>
        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handlePing(board.id)}
              className="p-1 rounded hover:bg-bg-surface text-text-muted hover:text-accent transition-colors cursor-pointer"
              title="Ping"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeleteId(board.id)}
              className="p-1 rounded hover:bg-bg-surface text-text-muted hover:text-status-error transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

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
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.dot.split(' ')[0]}`} />
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
      {/* Toolbar: Search + Filters + Views + New Board */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative min-w-[180px] max-w-xs">
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
        <div className="flex-1" />
        <div className="flex items-center bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('table')}
            className={`p-1.5 transition-colors ${viewMode === 'table' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'}`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`p-1.5 transition-colors ${viewMode === 'cards' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'}`}
            title="Card view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={`p-1.5 transition-colors ${viewMode === 'map' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated'}`}
            title="Map view"
          >
            <Map className="w-4 h-4" />
          </button>
        </div>
        <Button onClick={() => { setNewName(''); setNewGroupId(''); setShowCreate(true) }} size="sm">
          <Plus className="w-4 h-4" /> New Board
        </Button>
      </div>

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
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Deselect</Button>
        </div>
      )}

      {viewMode === 'map' ? (
        <BoardMap
          boards={boards}
          zones={zoneList}
          onBoardClick={(id) => navigate(`/boards/${id}`)}
        />
      ) : viewMode === 'cards' ? (
        <>
          {boards.length === 0 && !search && !selectedGroupId ? (
            <EmptyState icon={Monitor} title="No boards" description="Boards appear here when agents connect to the server." />
          ) : boards.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No boards match your search.</p>
          ) : renderCardView(boards)}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      ) : (
        /* ── List view: Boards left, Board Lists right ─────────────────── */
        <div className="flex gap-4">
          {/* Boards — vertical list */}
          <div className="flex-1 min-w-0">
            {boards.length === 0 && !search && !selectedGroupId ? (
              <EmptyState icon={Monitor} title="No boards" description="Boards appear here when agents connect to the server." />
            ) : boards.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">No boards match your search.</p>
            ) : (
              <div className="bg-bg-surface border border-border-default rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-text-muted uppercase tracking-wider border-b border-border-default bg-bg-primary">
                      <th className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={boards.length > 0 && selectedIds.size === boards.length}
                          onChange={toggleSelectAll}
                          className="rounded border-border-default accent-accent"
                        />
                      </th>
                      <th className="px-2 py-2 w-[120px]">Preview</th>
                      <th className="px-3 py-2 w-24">Status</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Content</th>
                      <th className="px-3 py-2">Zone</th>
                      <th className="px-3 py-2 w-16">CPU</th>
                      <th className="px-3 py-2 w-24">Memory</th>
                      <th className="px-3 py-2 w-24">Last Seen</th>
                      <th className="px-3 py-2 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {boards.map(renderBoardRow)}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="mt-4 flex justify-center">
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </div>

          {/* Board Lists — right sidebar */}
          <div className="w-64 flex-shrink-0 hidden lg:block">
            <div className="bg-bg-surface border border-border-default rounded-xl overflow-hidden sticky top-4">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-default bg-bg-primary">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Board Lists</span>
                <button
                  onClick={() => { setNewGroupName(''); setShowCreateGroup(true) }}
                  className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-accent transition-colors cursor-pointer"
                  title="New list"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* "All" option */}
              <button
                onClick={() => setSelectedGroupId(null)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer border-b border-border-default',
                  !selectedGroupId ? 'bg-accent/8 text-accent' : 'hover:bg-bg-elevated text-text-secondary',
                )}
              >
                <Monitor className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">All Boards</span>
                <span className="text-xs text-text-muted">{allBoards.length}</span>
              </button>

              {groups.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Layers className="w-5 h-5 text-text-muted/30 mx-auto mb-1.5" />
                  <p className="text-xs text-text-muted">No lists yet</p>
                </div>
              ) : (
                <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                  {groups.map((group) => {
                    const groupBoards = allBoards.filter((b) => b.group_id === group.id)
                    const onlineCount = groupBoards.filter((b) => {
                      const live = liveStatus?.[b.id]
                      return live ? live.connectivity !== 'offline' : b.status === 'online'
                    }).length
                    const isSelected = selectedGroupId === group.id

                    return (
                      <div
                        key={group.id}
                        onClick={() => setSelectedGroupId((prev) => (prev === group.id ? null : group.id))}
                        className={cn(
                          'group/item flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors border-b border-border-default last:border-0',
                          isSelected ? 'bg-accent/8' : 'hover:bg-bg-elevated',
                        )}
                      >
                        <Layers className={cn('w-4 h-4 flex-shrink-0', isSelected ? 'text-accent' : 'text-text-muted')} />
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm truncate', isSelected ? 'font-medium text-accent' : 'text-text-primary')}>
                            {group.name}
                          </p>
                          <p className="text-[11px] text-text-muted">
                            {groupBoards.length} boards{groupBoards.length > 0 && ` · ${onlineCount} online`}
                          </p>
                        </div>
                        {/* Status dots */}
                        <div className="flex flex-wrap gap-0.5 max-w-[40px] justify-end flex-shrink-0">
                          {groupBoards.slice(0, 8).map((b) => {
                            const st = getDisplayStatus(b, liveStatus?.[b.id])
                            return <div key={b.id} className={cn('w-1.5 h-1.5 rounded-full', STATUS_CONFIG[st].dot.split(' ')[0])} />
                          })}
                        </div>
                        {/* Actions on hover */}
                        <div
                          className="flex gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setEditGroupId(group.id); setEditGroupName(group.name) }}
                            className="p-1 rounded hover:bg-bg-surface text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                            title="Rename"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeleteGroupId(group.id)}
                            className="p-1 rounded hover:bg-bg-surface text-text-muted hover:text-status-error transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Board Modal */}
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
            label="Board List (optional)"
            value={newGroupId}
            onChange={(e) => setNewGroupId(e.target.value)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="No list"
          />
        </div>
      </Modal>

      {/* New Board List Modal */}
      <Modal
        open={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        title="New Board List"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateGroup(false)}>Cancel</Button>
            <Button onClick={handleCreateGroup} loading={createGroup.isPending} disabled={!newGroupName.trim()}>
              Create
            </Button>
          </>
        }
      >
        <Input
          label="List Name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="e.g. Downtown Campaign"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && newGroupName.trim()) handleCreateGroup() }}
        />
      </Modal>

      {/* Rename Board List Modal */}
      <Modal
        open={!!editGroupId}
        onClose={() => setEditGroupId(null)}
        title="Rename Board List"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditGroupId(null)}>Cancel</Button>
            <Button onClick={handleEditGroup} loading={updateGroup.isPending} disabled={!editGroupName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="List Name"
          value={editGroupName}
          onChange={(e) => setEditGroupName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && editGroupName.trim()) handleEditGroup() }}
        />
      </Modal>

      {/* Delete Board */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Board"
        message="This will permanently delete this board and its play logs."
        confirmLabel="Delete"
        loading={deleteBoard.isPending}
      />

      {/* Delete Board List */}
      <ConfirmDialog
        open={!!deleteGroupId}
        onClose={() => setDeleteGroupId(null)}
        onConfirm={handleDeleteGroup}
        title="Delete Board List"
        message="This removes the list. Boards in this list will not be deleted."
        confirmLabel="Delete List"
        loading={deleteGroup.isPending}
      />
    </div>
  )
}
