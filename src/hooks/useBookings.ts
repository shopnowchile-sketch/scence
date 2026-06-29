import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Booking } from '@/types'

interface BookingsParams {
  status?: string
  from?: string
  to?: string
  limit?: number
}

async function fetchBookings(params: BookingsParams = {}): Promise<{ data: Booking[] }> {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.from)   sp.set('from', params.from)
  if (params.to)     sp.set('to', params.to)
  if (params.limit)  sp.set('limit', String(params.limit))

  const res = await fetch(`/api/bookings?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar bookings')
  const json = await res.json()
  // Normalize: expose google_calendar_link from metadata for backward compat
  const data = (json.data ?? []).map((b: Booking) => ({
    ...b,
    google_calendar_link: (b.metadata as Record<string, unknown> | null)?.google_calendar_link as string ?? null,
  }))
  return { data }
}

export function useBookings(params: BookingsParams = {}) {
  return useQuery({
    queryKey: ['bookings', params],
    queryFn:  () => fetchBookings(params),
  })
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch('/api/bookings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar booking')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success('Booking actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export interface CreateBookingInput {
  title: string
  event_type: string
  starts_at: string
  ends_at: string
  influencer_id?: string | null
  campaign_id?: string | null
  location?: string | null
  is_virtual?: boolean
  virtual_link?: string | null
  fee?: number | null
  currency?: string
  description?: string | null
  notes?: string | null
  confirmation_status?: string | null
  influencer_ids?: string[]
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateBookingInput) => {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear booking')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success('Booking creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bookings?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al cancelar booking')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success('Booking cancelado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
