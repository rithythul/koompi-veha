import { useQuery } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type {
  PlayLog, PlayLogFilter, PlayLogSummary,
  PlayLogSummaryFilter, PaginatedResponse,
} from '../types/api'

export function usePlayLogs(params?: PlayLogFilter) {
  return useQuery({
    queryKey: ['play-logs', params],
    queryFn: () =>
      apiClient<PaginatedResponse<PlayLog>>(
        `/api/play-logs?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function usePlayLogSummary(params?: PlayLogSummaryFilter) {
  return useQuery({
    queryKey: ['play-logs', 'summary', params],
    queryFn: () =>
      apiClient<PlayLogSummary[]>(
        `/api/play-logs/summary?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}
