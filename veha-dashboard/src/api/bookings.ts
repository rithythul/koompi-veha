import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import { toQueryString } from '../lib/utils'
import type {
  Booking, CreateBooking, BookingFilter,
  PlayLog, PaginatedResponse,
} from '../types/api'

export function useBookings(params?: BookingFilter) {
  return useQuery({
    queryKey: ['bookings', params],
    queryFn: () =>
      apiClient<PaginatedResponse<Booking>>(
        `/api/bookings?${toQueryString(params as Record<string, unknown>)}`,
      ),
  })
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: ['bookings', id],
    queryFn: () => apiClient<Booking>(`/api/bookings/${id}`),
    enabled: !!id,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBooking) =>
      apiClient<Booking>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
}

export function useUpdateBooking(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBooking) =>
      apiClient<Booking>(`/api/bookings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['bookings', id] })
    },
  })
}

export function useDeleteBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<null>(`/api/bookings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
}

export function useBookingPlayLogs(
  bookingId: string,
  params?: { page?: number; per_page?: number },
) {
  return useQuery({
    queryKey: ['bookings', bookingId, 'play-logs', params],
    queryFn: () =>
      apiClient<PaginatedResponse<PlayLog>>(
        `/api/bookings/${bookingId}/play-logs?${toQueryString(params as Record<string, unknown>)}`,
      ),
    enabled: !!bookingId,
  })
}
