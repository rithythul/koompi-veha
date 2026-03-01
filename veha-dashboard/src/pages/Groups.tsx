import { useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useGroups, useCreateGroup, useDeleteGroup } from '../api/groups'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'

export default function Groups() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useGroups({ page, per_page: 50 })
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const createGroup = useCreateGroup()
  const deleteGroup = useDeleteGroup()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const groups = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const handleCreate = () => {
    createGroup.mutate({ name }, {
      onSuccess: () => {
        toast.success('Group created')
        setShowForm(false)
        setName('')
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = () => {
    if (!deleteId) return
    deleteGroup.mutate(deleteId, {
      onSuccess: () => {
        toast.success('Group deleted')
        setDeleteId(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Groups</h1>
        <Button onClick={() => { setName(''); setShowForm(true) }} size="sm">
          <Plus className="w-4 h-4" /> New Group
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No groups"
          description="Groups let you organize boards and send commands to multiple boards at once."
          action={{ label: 'New Group', onClick: () => setShowForm(true) }}
        />
      ) : (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-3 text-text-primary font-medium">{group.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(group.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(group.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-status-error" />
                    </Button>
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
        title="New Group"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={createGroup.isPending} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <Input
          label="Group Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Downtown Billboards"
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Group"
        message="Are you sure? Boards in this group will be ungrouped."
        loading={deleteGroup.isPending}
      />
    </div>
  )
}
