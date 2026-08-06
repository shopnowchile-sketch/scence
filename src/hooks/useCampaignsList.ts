import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Campaign, CampaignDetail } from '@/types'

// ── Fetch list ────────────────────────────────────────────────────────────────
interface ListParams {
  status?: string
  type?: string
  platform?: string
  visibility?: string
  brandId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
  apiBase?: string
  enabled?: boolean
}

export interface CampaignSummary {
  active: number
  totalBudget: number
  totalSpent: number
  pendingDeliverables: number
  pendingApprovalCount: number
}

function toSearchParams(params: ListParams) {
  const sp = new URLSearchParams()
  if (params.status)     sp.set('status', params.status)
  if (params.type)       sp.set('type', params.type)
  if (params.platform)   sp.set('platform', params.platform)
  if (params.visibility) sp.set('visibility', params.visibility)
  if (params.brandId)    sp.set('brandId', params.brandId)
  if (params.search)     sp.set('search', params.search)
  if (params.dateFrom)   sp.set('date_from', params.dateFrom)
  if (params.dateTo)     sp.set('date_to', params.dateTo)
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  return sp
}

async function fetchCampaigns(params: ListParams): Promise<{ data: Campaign[]; total: number }> {
  const sp = toSearchParams(params)

  const base = params.apiBase ?? '/api/campaigns'
  const res = await fetch(`${base}?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar campañas')
  return res.json()
}

export function useCampaignsList(params: ListParams = {}) {
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn:  () => fetchCampaigns(params),
    enabled:  params.enabled ?? true,
    staleTime: 30_000,
  })
}

export function useCampaignsSummary(params: ListParams = {}) {
  return useQuery({
    queryKey: ['campaigns-summary', params],
    queryFn: async () => {
      const sp = toSearchParams(params)
      sp.set('summary', '1')
      const res = await fetch(`/api/campaigns?${sp.toString()}`)
      if (!res.ok) throw new Error('Error al cargar resumen de campañas')
      const json = await res.json() as { summary: CampaignSummary }
      return json.summary
    },
    enabled: params.enabled ?? true,
    staleTime: 30_000,
  })
}

// ── Fetch single ──────────────────────────────────────────────────────────────
async function fetchCampaign(id: string, apiBase = '/api/campaigns') {
  const res = await fetch(`${apiBase}/${id}`)
  if (!res.ok) throw new Error('Campaña no encontrada')
  return res.json() as Promise<{ data: CampaignDetail }>
}

export function useCampaignDetail(id: string, apiBase = '/api/campaigns') {
  return useQuery({
    queryKey: ['campaign', apiBase, id],
    queryFn:  () => fetchCampaign(id, apiBase),
    enabled:  !!id,
  })
}

// ── Patch campaign status ─────────────────────────────────────────────────────
export function usePatchCampaign(id: string, apiBase = '/api/campaigns') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`${apiBase}/${id}`, {
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
      qc.invalidateQueries({ queryKey: ['campaign', apiBase, id] })
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
      // La consulta de detalle usa ['campaign', apiBase, campaignId]. Antes se
      // invalidaba ['campaign', campaignId], que no coincide con esa clave, por
      // lo que rating/aprobación se guardaban en BD pero la vista seguía mostrando
      // datos antiguos hasta salir y volver a entrar.
      qc.invalidateQueries({ queryKey: ['campaign'] })
      toast.success('Influencer eliminado de la campaña')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Deliverable action ────────────────────────────────────────────────────────
export function useDeliverableAction(campaignId: string) {
  const qc = useQueryClient()

  type DeliverableActionPayload = {
    deliverable_id: string
    action: 'approve' | 'reject' | 'submit' | 'publish' | 'update_progress' | 'rate'
    review_notes?: string
    progress?: number
    rating?: number
  }

  type CampaignCache = { data: CampaignDetail }

  const patchDeliverable = (current: CampaignCache | undefined, payload: DeliverableActionPayload) => {
    if (!current?.data?.campaign_deliverables) return current

    return {
      ...current,
      data: {
        ...current.data,
        campaign_deliverables: current.data.campaign_deliverables.map(deliverable => {
          if (deliverable.id !== payload.deliverable_id) return deliverable
          if (payload.action === 'rate') return { ...deliverable, content_rating: payload.rating ?? null }
          if (payload.action === 'approve') return { ...deliverable, status: 'approved' as const, review_notes: payload.review_notes ?? deliverable.review_notes }
          if (payload.action === 'reject') return { ...deliverable, status: 'rejected' as const, review_notes: payload.review_notes ?? deliverable.review_notes }
          if (payload.action === 'submit') return { ...deliverable, status: 'in_review' as const }
          if (payload.action === 'publish') return { ...deliverable, status: 'published' as const }
          if (payload.action === 'update_progress') return { ...deliverable, progress: payload.progress ?? deliverable.progress }
          return deliverable
        }),
      },
    }
  }

  return useMutation({
    mutationFn: async (payload: DeliverableActionPayload) => {
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
    onMutate: async payload => {
      // Actualiza la única fuente de datos que renderiza la pantalla ANTES de
      // esperar la red. Así estrellas, aprobación y progreso no dependen de
      // estados locales que puedan quedar desfasados.
      await qc.cancelQueries({ queryKey: ['campaign'] })
      const previous = qc.getQueriesData<CampaignCache>({ queryKey: ['campaign'] })
      qc.setQueriesData<CampaignCache>({ queryKey: ['campaign'] }, current => patchDeliverable(current, payload))
      return { previous }
    },
    onSuccess: (response) => {
      // Reemplaza el valor optimista por la fila exacta confirmada por la API.
      qc.setQueriesData<CampaignCache>({ queryKey: ['campaign'] }, current => {
        if (!current?.data?.campaign_deliverables) return current
        return {
          ...current,
          data: {
            ...current.data,
            campaign_deliverables: current.data.campaign_deliverables.map(deliverable =>
              deliverable.id === response.data.id
                ? { ...deliverable, ...response.data }
                : deliverable
            ),
          },
        }
      })
    },
    onError: (err: Error, _payload, context) => {
      // Si la API rechaza la acción, vuelve exactamente al estado previo para
      // que la interfaz nunca muestre un cambio que no se guardó.
      context?.previous.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data))
      toast.error(err.message)
    },
    onSettled: () => {
      // El refetch final confirma el resto de datos derivados (promedio,
      // timestamps), sin borrar el cambio optimista durante el clic.
      qc.invalidateQueries({
        predicate: query => query.queryKey[0] === 'campaign' && query.queryKey[2] === campaignId,
      })
    },
  })
}

// ── Sync deliverable metrics (Apify: views/likes/comments reales) ────────────
export function useSyncDeliverableMetrics(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deliverableId: string) => {
      const res = await fetch(`/api/campaign-deliverables/${deliverableId}/sync-metrics`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al actualizar métricas')
      return json
    },
    onSuccess: () => {
      // Releer el detalle activo tanto en Admin como en Marca después de traer
      // métricas, usando el mismo prefijo con que se registra la consulta.
      qc.invalidateQueries({ queryKey: ['campaign'] })
      toast.success('Métricas actualizadas')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
