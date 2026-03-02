import { useState } from 'react'
import { Building2, Plus, Pencil, Trash2 } from 'lucide-react'
import { useAdvertisers, useCreateAdvertiser, useUpdateAdvertiser, useDeleteAdvertiser } from '../api/advertisers'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { Pagination } from '../components/ui/Pagination'
import { useToast } from '../components/ui/Toast'
import type { Advertiser, CreateAdvertiser } from '../types/api'

export default function Advertisers() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAdvertisers({ page, per_page: 50 })
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Advertiser | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CreateAdvertiser>({ name: '' })

  const createAdv = useCreateAdvertiser()
  const updateAdv = useUpdateAdvertiser(editItem?.id ?? '')
  const deleteAdv = useDeleteAdvertiser()
  const toast = useToast()

  if (isLoading) return <PageSpinner />

  const items = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.per_page ?? 50))

  const openCreate = () => {
    setEditItem(null)
    setFormData({ name: '' })
    setShowForm(true)
  }

  const openEdit = (item: Advertiser) => {
    setEditItem(item)
    setFormData({
      name: item.name,
      contact_name: item.contact_name ?? undefined,
      contact_email: item.contact_email ?? undefined,
      contact_phone: item.contact_phone ?? undefined,
      notes: item.notes ?? undefined,
    })
    setShowForm(true)
  }

  const handleSave = () => {
    const mutation = editItem ? updateAdv : createAdv
    mutation.mutate(formData, {
      onSuccess: () => {
        toast.success(editItem ? 'Advertiser updated' : 'Advertiser created')
        setShowForm(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteAdv.mutateAsync(deleteId)
      toast.success('Advertiser deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Advertisers</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> New Advertiser
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No advertisers"
          description="Add advertisers to start managing ad campaigns."
          action={{ label: 'New Advertiser', onClick: openCreate }}
        />
      ) : (
        <Card padding={false}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border-default">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border-default last:border-0 hover:bg-bg-elevated transition-colors">
                  <td className="px-4 py-3 text-text-primary font-medium">{item.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{item.contact_name ?? '--'}</td>
                  <td className="px-4 py-3 text-text-secondary">{item.contact_email ?? '--'}</td>
                  <td className="px-4 py-3 text-text-secondary">{item.contact_phone ?? '--'}</td>
                  <td className="px-4 py-3">
                    {item.is_house ? (
                      <Badge variant="accent">House</Badge>
                    ) : (
                      <Badge variant="default">Standard</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!item.is_house && (
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
        title={editItem ? 'Edit Advertiser' : 'New Advertiser'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={createAdv.isPending || updateAdv.isPending}>
              {editItem ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Company Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Cellcard" />
          <Input label="Contact Name" value={formData.contact_name ?? ''} onChange={(e) => setFormData({ ...formData, contact_name: e.target.value || undefined })} />
          <Input label="Email" type="email" value={formData.contact_email ?? ''} onChange={(e) => setFormData({ ...formData, contact_email: e.target.value || undefined })} />
          <Input label="Phone" value={formData.contact_phone ?? ''} onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value || undefined })} />
          <Textarea label="Notes" value={formData.notes ?? ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value || undefined })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Advertiser"
        message="This will also delete all their campaigns and bookings."
        loading={deleteAdv.isPending}
      />
    </div>
  )
}
