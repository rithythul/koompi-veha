import { useQuery } from '@tanstack/react-query'
import { apiClient } from './client'
import type { RevenueReport, RevenueReportFilter } from '../types/api'

export function useRevenueReport(params: RevenueReportFilter) {
  const searchParams = new URLSearchParams()
  if (params.start_date) searchParams.set('start_date', params.start_date)
  if (params.end_date) searchParams.set('end_date', params.end_date)
  if (params.group_by) searchParams.set('group_by', params.group_by)
  const qs = searchParams.toString()

  return useQuery({
    queryKey: ['reports', 'revenue', params],
    queryFn: () =>
      apiClient<RevenueReport>(`/api/reports/revenue${qs ? `?${qs}` : ''}`),
  })
}
