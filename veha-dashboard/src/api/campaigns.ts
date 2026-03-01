import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type {
  Campaign, CreateCampaign, CampaignFilter, CampaignPerformance,
  Creative, CreateCreative, PaginatedResponse,
} from '../types/api'

export function useCampaigns(params?: CampaignFilter) {
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Campaign>>(
        `/api/campaigns?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => apiClient<Campaign>(`/api/campaigns/${id}`),
    enabled: !!id,
  })
}

export function useCreateCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCampaign) =>
      apiClient<Campaign>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  })
}

export function useUpdateCampaign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCampaign) =>
      apiClient<Campaign>(`/api/campaigns/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaigns', id] })
    },
  })
}

export function useDeleteCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  })
}

export function useActivateCampaign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient<Campaign>(`/api/campaigns/${id}/activate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaigns', id] })
    },
  })
}

export function usePauseCampaign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient<Campaign>(`/api/campaigns/${id}/pause`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['campaigns', id] })
    },
  })
}

export function useCreatives(campaignId: string) {
  return useQuery({
    queryKey: ['campaigns', campaignId, 'creatives'],
    queryFn: () =>
      apiClient<Creative[]>(`/api/campaigns/${campaignId}/creatives`),
    enabled: !!campaignId,
  })
}

export function useCreateCreative(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCreative) =>
      apiClient<Creative>(`/api/campaigns/${campaignId}/creatives`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'creatives'] }),
  })
}

export function useDeleteCreative() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/creatives/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  })
}

export function useCampaignPerformance(id: string) {
  return useQuery({
    queryKey: ['campaigns', id, 'performance'],
    queryFn: () => apiClient<CampaignPerformance>(`/api/campaigns/${id}/performance`),
    enabled: !!id,
  })
}

export function useApproveCreative(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/creatives/${id}/approve`, { method: 'POST' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'creatives'] }),
  })
}

export function useRejectCreative(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/creatives/${id}/reject`, { method: 'POST' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'creatives'] }),
  })
}
