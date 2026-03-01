import { useState } from 'react'
import { Users as UsersIcon, Plus, Pencil, Trash2 } from 'lucide-react'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../api/users'
import { useAuthStore } from '../stores/auth'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import type { UserResponse, CreateUser, UpdateUser } from '../types/api'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'operator', label: 'Operator' },
  { value: 'viewer', label: 'Viewer' },
]

const roleBadgeVariant: Record<string, 'accent' | 'online' | 'default'> = {
  admin: 'accent',
  operator: 'online',
  viewer: 'default',
}

export default function Users() {
  const currentUser = useAuthStore((s) => s.user)
  const [page, setPage] = useState(1)
  const { data, isLoading } = useUsers({ page, per_page: 50 })
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<UserResponse | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateUser & { password?: string }>({
    username: '',
    password: '',
    role: 'viewer',
  })

  const createUser = useCreateUser()
  const updateUser = useUpdateUser(editItem?.id ?? '')
  const deleteUser = useDeleteUser()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const items = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const openCreate = () => {
    setEditItem(null)
    setFormData({ username: '', password: '', role: 'viewer' })
    setShowForm(true)
  }

  const openEdit = (item: UserResponse) => {
    setEditItem(item)
    setFormData({ username: item.username, password: '', role: item.role })
    setShowForm(true)
  }

  const handleSave = () => {
    if (editItem) {
      const payload: UpdateUser = {}
      if (formData.username && formData.username !== editItem.username) {
        payload.username = formData.username
      }
      if (formData.role && formData.role !== editItem.role) {
        payload.role = formData.role
      }
      if (formData.password) {
        payload.password = formData.password
      }
      updateUser.mutate(payload, {
        onSuccess: () => {
          toast.success('User updated')
          setShowForm(false)
        },
        onError: (err) => toast.error(err.message),
      })
    } else {
      if (!formData.username || !formData.password) {
        toast.error('Username and password are required')
        return
      }
      createUser.mutate(
        { username: formData.username, password: formData.password, role: formData.role },
        {
          onSuccess: () => {
            toast.success('User created')
            setShowForm(false)
          },
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  const handleDelete = () => {
    if (!deleteId) return
    deleteUser.mutate(deleteId, {
      onSuccess: () => {
        toast.success('User deleted')
        setDeleteId(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Users</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New User
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users"
          description="Add users to manage access to the platform."
          action={{ label: 'New User', onClick: openCreate }}
        />
      ) : (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors"
                >
                  <td className="px-4 py-3 text-text-primary font-medium">
                    {item.username}
                    {item.id === currentUser?.id && (
                      <span className="ml-2 text-xs text-text-muted">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={roleBadgeVariant[item.role] ?? 'default'}>
                      {item.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {item.id !== currentUser?.id && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(item.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-status-error" />
                        </Button>
                      )}
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
        title={editItem ? 'Edit User' : 'New User'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              loading={createUser.isPending || updateUser.isPending}
            >
              {editItem ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Username"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            placeholder="e.g. johndoe"
          />
          <Input
            label={editItem ? 'New Password (leave blank to keep current)' : 'Password'}
            type="password"
            value={formData.password ?? ''}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder={editItem ? 'Leave blank to keep current' : 'Enter password'}
          />
          <Select
            label="Role"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            options={ROLE_OPTIONS}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
        loading={deleteUser.isPending}
      />
    </div>
  )
}
