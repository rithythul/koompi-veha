import { useState } from 'react'
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react'
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../api/apikeys'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { formatDateTime, copyToClipboard } from '../lib/utils'

export default function Settings() {
  const { data: keys, isLoading } = useApiKeys()
  const createKey = useCreateApiKey()
  const deleteKey = useDeleteApiKey()
  const toast = useToast()

  const [showCreate, setShowCreate] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedPreview, setCopiedPreview] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!keyName.trim()) return
    try {
      const data = await createKey.mutateAsync({ name: keyName.trim() })
      setCreatedKey(data.key)
      setKeyName('')
      setShowCreate(false)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleCopy = async () => {
    if (!createdKey) return
    try {
      await copyToClipboard(createdKey)
      setCopied(true)
      toast.success('API key copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteKey.mutateAsync(deleteId)
      toast.success('API key deleted')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteId(null)
    }
  }

  if (isLoading) return <PageSpinner />

  const keyList = keys ?? []

  return (
    <div className="animate-fade-in">
      <p className="text-xs text-text-secondary mb-6">Manage API keys and integrations</p>

      <Card
        title="API Keys"
        action={
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> Create Key
          </Button>
        }
      >
        {keyList.length === 0 ? (
          <EmptyState
            icon={Key}
            title="No API keys"
            description="Create an API key for programmatic access to the Veha API."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted text-xs border-b border-border-default">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Preview</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Last Used</th>
                  <th className="pb-2 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {keyList.map((k) => (
                  <tr key={k.id} className="border-b border-border-default last:border-0">
                    <td className="py-2.5 text-text-primary font-medium">{k.name}</td>
                    <td className="py-2.5">
                      <button
                        className="inline-flex items-center gap-1.5 group cursor-pointer"
                        onClick={async () => {
                          try {
                            await copyToClipboard(k.preview)
                            setCopiedPreview(k.id)
                            toast.success('Key preview copied')
                            setTimeout(() => setCopiedPreview(null), 2000)
                          } catch {
                            toast.error('Failed to copy')
                          }
                        }}
                        title="Click to copy"
                      >
                        <code className="text-xs bg-bg-elevated px-1.5 py-0.5 rounded text-text-secondary group-hover:text-text-primary transition-colors">
                          {k.preview}...
                        </code>
                        {copiedPreview === k.id ? (
                          <Check className="w-3 h-3 text-status-success" />
                        ) : (
                          <Copy className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    </td>
                    <td className="py-2.5 text-text-muted">{formatDateTime(k.created_at)}</td>
                    <td className="py-2.5 text-text-muted">
                      {k.last_used_at ? formatDateTime(k.last_used_at) : 'Never'}
                    </td>
                    <td className="py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(k.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-status-error" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Key Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create API Key">
        <div className="space-y-4">
          <Input
            label="Key Name"
            placeholder="e.g. CI/CD Pipeline"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={createKey.isPending} disabled={!keyName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Show Created Key */}
      <Modal
        open={!!createdKey}
        onClose={() => setCreatedKey(null)}
        title="API Key Created"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Copy your API key now. You won't be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-bg-elevated px-3 py-2 rounded-md text-text-primary font-mono break-all">
              {createdKey}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Use this key in the <code className="bg-bg-elevated px-1 py-0.5 rounded">X-API-Key</code> header for authenticated requests.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete API Key"
        message="This will revoke access for any integrations using this key. This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteKey.isPending}
      />
    </div>
  )
}
