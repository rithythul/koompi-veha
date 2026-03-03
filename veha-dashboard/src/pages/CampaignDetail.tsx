import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Megaphone, Plus, Trash2, Play, Pause, Check, X } from 'lucide-react'
import {
  useCampaign, useActivateCampaign, usePauseCampaign, useDeleteCampaign,
  useCreatives, useCreateCreative, useDeleteCreative,
  useCampaignPerformance, useApproveCreative, useRejectCreative,
} from '../api/campaigns'
import { useAdvertiser } from '../api/advertisers'
import { useMedia, mediaThumbnailUrl, mediaDownloadUrl } from '../api/media'
import { MediaThumb } from '../components/ui/MediaThumb'
import { useBookings } from '../api/bookings'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { PageSpinner } from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { formatDate, getDaysOfWeekLabels, formatCurrency, formatDuration } from '../lib/utils'

const statusVariant: Record<string, 'info' | 'online' | 'warning' | 'default'> = {
  draft: 'info',
  active: 'online',
  paused: 'warning',
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: campaign, isLoading } = useCampaign(id ?? '')
  const { data: advertiser } = useAdvertiser(campaign?.advertiser_id ?? '')
  const { data: creatives } = useCreatives(id ?? '')
  const { data: mediaData } = useMedia({ per_page: 200 })
  const { data: bookingsData } = useBookings({ campaign_id: id, per_page: 50 })

  const { data: performance } = useCampaignPerformance(id ?? '')
  const activate = useActivateCampaign(id ?? '')
  const pause = usePauseCampaign(id ?? '')
  const createCreative = useCreateCreative(id ?? '')
  const deleteCreative = useDeleteCreative()
  const approveCreative = useApproveCreative(id ?? '')
  const rejectCreative = useRejectCreative(id ?? '')
  const toast = useToast()

  const deleteCampaign = useDeleteCampaign()
  const [showMediaPicker, setShowMediaPicker] = useState(false)
  const [deleteCreativeId, setDeleteCreativeId] = useState<string | null>(null)
  const [showDeleteCampaign, setShowDeleteCampaign] = useState(false)

  if (isLoading || !campaign) return <PageSpinner />

  const mediaList = mediaData?.data ?? []
  const creativesList = creatives ?? []
  const bookings = bookingsData?.data ?? []

  const handleActivate = async () => {
    try {
      await activate.mutateAsync(undefined)
      toast.success('Campaign activated')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handlePause = async () => {
    try {
      await pause.mutateAsync(undefined)
      toast.success('Campaign paused')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleAddCreative = async (mediaId: string) => {
    const media = mediaList.find((m) => m.id === mediaId)
    try {
      await createCreative.mutateAsync({ media_id: mediaId, name: media?.name })
      toast.success('Creative added')
      setShowMediaPicker(false)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDeleteCreative = async () => {
    if (!deleteCreativeId) return
    try {
      await deleteCreative.mutateAsync(deleteCreativeId)
      toast.success('Creative removed')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleteCreativeId(null)
    }
  }

  const handleApproveCreative = async (creativeId: string) => {
    try {
      await approveCreative.mutateAsync(creativeId)
      toast.success('Creative approved')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleRejectCreative = async (creativeId: string) => {
    try {
      await rejectCreative.mutateAsync(creativeId)
      toast.success('Creative rejected')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDeleteCampaign = async () => {
    try {
      await deleteCampaign.mutateAsync(id!)
      toast.success('Campaign deleted')
      navigate('/campaigns')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setShowDeleteCampaign(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Campaigns
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-accent/15 rounded-lg flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{campaign.name}</h1>
          <p className="text-xs text-text-secondary">{advertiser?.name ?? campaign.advertiser_id}</p>
        </div>
        <Badge variant={statusVariant[campaign.status] ?? 'default'} className="ml-2">
          {campaign.status}
        </Badge>
        <div className="ml-auto flex gap-2">
          {(campaign.status === 'draft' || campaign.status === 'paused') && (
            <Button size="sm" onClick={handleActivate} loading={activate.isPending}>
              <Play className="w-3.5 h-3.5" /> Activate
            </Button>
          )}
          {campaign.status === 'active' && (
            <Button variant="secondary" size="sm" onClick={handlePause} loading={pause.isPending}>
              <Pause className="w-3.5 h-3.5" /> Pause
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setShowDeleteCampaign(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Campaign Info */}
          <Card title="Campaign Info">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-text-muted text-xs mb-1">Advertiser</p>
                <p className="text-text-primary">{advertiser?.name ?? '--'}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Start Date</p>
                <p className="text-text-primary">{formatDate(campaign.start_date)}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">End Date</p>
                <p className="text-text-primary">{formatDate(campaign.end_date)}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs mb-1">Budget</p>
                <p className="text-text-primary">{formatCurrency(campaign.budget)}</p>
              </div>
              {campaign.budget != null && (
                <div>
                  <p className="text-text-muted text-xs mb-1">Spent (est.)</p>
                  <p className="text-text-primary">
                    {formatCurrency(bookings.reduce((sum, b) => sum + (b.estimated_cost ?? 0), 0))}
                  </p>
                </div>
              )}
              {campaign.notes && (
                <div className="col-span-full">
                  <p className="text-text-muted text-xs mb-1">Notes</p>
                  <p className="text-text-secondary">{campaign.notes}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Performance Stats */}
          {performance && (
            <Card title="Performance">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-text-muted text-xs mb-1">Total Plays</p>
                  <p className="text-text-primary font-semibold text-lg">{performance.total_plays.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Total Duration</p>
                  <p className="text-text-primary font-semibold text-lg">{formatDuration(performance.total_duration_secs)}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Est. Reach</p>
                  <p className="text-text-primary font-semibold text-lg">{performance.estimated_reach.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs mb-1">Cost per Play</p>
                  <p className="text-text-primary font-semibold text-lg">{formatCurrency(performance.cost_per_play)}</p>
                </div>
                {performance.budget_utilization != null && (
                  <div className="col-span-2">
                    <p className="text-text-muted text-xs mb-1">Budget Utilization</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${Math.min(performance.budget_utilization, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-secondary font-medium">
                        {performance.budget_utilization.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Creatives */}
          <Card
            title={`Creatives (${creativesList.length})`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setShowMediaPicker(true)}>
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            }
          >
            {creativesList.length === 0 ? (
              <p className="text-sm text-text-muted">No creatives. Add media from the library.</p>
            ) : (
              <div className="space-y-2">
                {creativesList.map((cr) => {
                  const media = mediaList.find((m) => m.id === cr.media_id)
                  return (
                  <div
                    key={cr.id}
                    className="flex items-center justify-between px-3 py-2 bg-bg-primary rounded-md"
                  >
                    <div className="flex items-center gap-3">
                      <MediaThumb mediaId={cr.media_id} mimeType={media?.mime_type} name={cr.name ?? undefined} />
                      <span className="text-sm text-text-primary">{cr.name ?? 'Untitled'}</span>
                      {cr.duration_secs && (
                        <span className="text-xs text-text-muted">{cr.duration_secs}s</span>
                      )}
                      <Badge
                        variant={
                          cr.approval_status === 'approved' ? 'online'
                            : cr.approval_status === 'rejected' ? 'error'
                            : 'warning'
                        }
                        className="text-[10px]"
                      >
                        {cr.approval_status === 'pending_review' ? 'pending review' : cr.approval_status ?? cr.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {cr.approval_status === 'pending_review' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleApproveCreative(cr.id)}
                            disabled={approveCreative.isPending || rejectCreative.isPending}
                          >
                            <Check className="w-3.5 h-3.5 text-status-online" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRejectCreative(cr.id)}
                            disabled={approveCreative.isPending || rejectCreative.isPending}
                          >
                            <X className="w-3.5 h-3.5 text-status-error" />
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setDeleteCreativeId(cr.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-status-error" />
                      </Button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Bookings */}
        <div>
          <Card title={`Bookings (${bookings.length})`}>
            {bookings.length === 0 ? (
              <p className="text-sm text-text-muted">No bookings for this campaign.</p>
            ) : (
              <div className="space-y-2">
                {bookings.map((b) => (
                  <div key={b.id} className="px-3 py-2 bg-bg-primary rounded-md text-sm">
                    <div className="flex items-center justify-between">
                      <Badge variant={b.booking_type === 'exclusive' ? 'warning' : 'accent'} className="text-[10px]">
                        {b.booking_type}
                      </Badge>
                      <Badge variant="default" className="text-[10px]">
                        {b.target_type}
                      </Badge>
                    </div>
                    <p className="text-text-muted text-xs mt-1">
                      {formatDate(b.start_date)} - {formatDate(b.end_date)}
                    </p>
                    <p className="text-text-muted text-xs">
                      {getDaysOfWeekLabels(b.days_of_week)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Media Picker */}
      <Modal open={showMediaPicker} onClose={() => setShowMediaPicker(false)} title="Select Media">
        <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
          {mediaList.map((media) => (
            <button
              key={media.id}
              onClick={() => handleAddCreative(media.id)}
              className="rounded-lg border border-border-default hover:border-accent overflow-hidden transition-colors cursor-pointer"
            >
              {media.mime_type.startsWith('image/') ? (
                <img src={mediaDownloadUrl(media.id)} alt={media.name} className="aspect-video object-cover w-full" loading="lazy" />
              ) : media.mime_type.startsWith('video/') ? (
                <img src={mediaThumbnailUrl(media.id)} alt={media.name} className="aspect-video object-cover w-full bg-bg-elevated" loading="lazy" />
              ) : (
                <div className="aspect-video bg-bg-elevated flex items-center justify-center">
                  <Plus className="w-6 h-6 text-text-muted" />
                </div>
              )}
              <p className="text-[10px] text-text-primary truncate px-2 py-1">{media.name}</p>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteCreativeId}
        onClose={() => setDeleteCreativeId(null)}
        onConfirm={handleDeleteCreative}
        title="Remove Creative"
        message="Remove this creative from the campaign?"
        confirmLabel="Remove"
        loading={deleteCreative.isPending}
      />

      <ConfirmDialog
        open={showDeleteCampaign}
        onClose={() => setShowDeleteCampaign(false)}
        onConfirm={handleDeleteCampaign}
        title="Delete Campaign"
        message="This will permanently delete this campaign, its creatives, and associated bookings."
        confirmLabel="Delete"
        loading={deleteCampaign.isPending}
      />
    </div>
  )
}
