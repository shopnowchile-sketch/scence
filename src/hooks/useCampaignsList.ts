import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Campaign, CampaignDetail } from '@/types'

// ── Fetch list ────────────────────────────────────────────────────────────────
interface ListParams {
  status?: string
  type?: string
  platform?: string
  search?: string
  page?: number
  limit?: number
  apiBase?: string
}

async function fetchCampaigns(params: ListParams): Promise<{ data: Campaign[]; total: number }> {
  const sp = new URLSearchParams()
  if (params.status)   sp.set('status', params.status)
  if (params.type)     sp.set('type', params.type)
  if (params.platform) sp.set('platform', params.platform)
  if (params.search)   sp.set('search', params.search)
  if (params.page)     sp.set('page', String(params.page))
  if (params.limit)    sp.set('limit', String(params.limit))

  const base = params.apiBase ?? '/api/campaigns'
  const res = await fetch(`${base}?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar campañas')
  return res.json()
}

export function useCampaignsList(params: ListParams = {}) {
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn:  () => fetchCampaigns(params),
  })
}

// ── Fetch single ──────────────────────────────────────────────────────────────
async function fetchCampaign(id: string) {
  const res = await fetch(`/api/campaigns/${id}`)
  if (!res.ok) throw new Error('Campaña no encontrada')
  return res.json() as Promise<{ data: CampaignDetail }>
}

export function useCampaignDetail(id: string) {
  return useQuery({
    queryKey: ['campaign', id],
    queryFn:  () => fetchCampaign(id),
    enabled:  !!id,
  })
}

// ── Patch campaign status ─────────────────────────────────────────────────────
export function usePatchCampaign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar campaña')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', id] })
      qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Remove influencer from campaign ──────────────────────────────────────────
export function useRemoveCampaignInfluencer(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (influencerId: string) => {
      const res = await fetch(
        `/api/campaigns/${campaignId}/influencers?influencer_id=${influencerId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al eliminar influencer')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', campaignId] })
      toast.success('Influencer eliminado de la campaña')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Deliverable action ────────────────────────────────────────────────────────
export function useDeliverableAction(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      deliverable_id: string
      action: 'approve' | 'reject' | 'submit' | 'publish'
      review_notes?: string
    }) => {
      const res = await fetch(`/api/campaigns/${campaignId}/deliverables`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar deliverable')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', campaignId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
