import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Plus, Search, List, Map } from 'lucide-react'
import { useBoards, useCreateBoard } from '../api/boards'
import { useZones } from '../api/zones'
import { useGroups } from '../api/groups'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Modal } from '../components/ui/Modal'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatRelativeTime } from '../lib/utils'
import { SELL_MODES } from '../lib/constants'
import { BoardMap } from '../components/boards/BoardMap'
import { useBoardStatus } from '../hooks/useBoardStatus'

export default function Boards() {
  useBoardStatus()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterZone, setFilterZone] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSellMode, setFilterSellMode] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table')

  const { data, isLoading } = useBoards({
    page,
    per_page: 50,
    zone_id: filterZone || undefined,
    status: filterStatus || undefined,
    sell_mode: filterSellMode || undefined,
  })

  const { data: zones } = useZones()
  const { data: groupsData } = useGroups({ per_page: 200 })
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  const createBoard = useCreateBoard()
  const toast = useToast()

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

  if (isLoading) return <PageSpinner />

  const handleCreate = () => {
    createBoard.mutate(
      { name: newName, group_id: newGroupId || undefined },
      {
        onSuccess: () => {
          toast.success('Board created')
          setShowCreate(false)
          setNewName('')
          setNewGroupId('')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search boards..."
            className="w-full bg-bg-surface border border-border-default rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <Select
          value={filterZone}
          onChange={(e) => { setFilterZone(e.target.value); setPage(1) }}
          options={zoneList.map((z) => ({ value: z.id, label: z.name }))}
          placeholder="All Zones"
          className="w-40"
        />
        <Select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
          options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]}
          placeholder="All Status"
          className="w-36"
        />
        <Select
          value={filterSellMode}
          onChange={(e) => { setFilterSellMode(e.target.value); setPage(1) }}
          options={SELL_MODES.map((s) => ({ value: s.value, label: s.label }))}
          placeholder="All Modes"
          className="w-40"
        />
      </div>

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
      ) : (
        <>
          <Card padding={false}>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Sell Mode</th>
                  <th className="px-4 py-3">Resolution</th>
                  <th className="px-4 py-3">Last Seen</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {boards.map((board) => (
                  <tr
                    key={board.id}
                    onClick={() => navigate(`/boards/${board.id}`)}
                    className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-text-primary font-medium">{board.name}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={board.status === 'online' ? 'online' : 'offline'}
                        dot
                      >
                        {board.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{getZoneName(board.zone_id)}</td>
                    <td className="px-4 py-3 text-text-secondary capitalize">{board.sell_mode?.replace('_', ' ') ?? '--'}</td>
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                      {board.screen_width && board.screen_height
                        ? `${board.screen_width}x${board.screen_height}`
                        : '--'}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">{formatRelativeTime(board.last_seen)}</td>
                  </tr>
                ))}
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
    </div>
  )
}
