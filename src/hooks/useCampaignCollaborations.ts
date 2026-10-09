import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CampaignPlan, CollaborationActivity, CollaborationRow } from '@/lib/campaign-collaborations-shared'

export interface CollaborationOwner { id: string; name: string }
export interface CollaborationCandidates {
  leads: { id: string; company_name: string | null; contact_name: string | null; email: string | null; instagram: string | null; industry: string | null }[]
  brands: { id: string; name: string | null; logo_url: string | null; contact_name: string | null; contact_email: string | null; instagram: string | null; industry: string | null }[]
}

const listKey = (campaignId: string) => ['campaign-collaborations', campaignId] as const
const historyKey = (campaignId: string, collabId: string | null) => ['campaign-collaborations', campaignId, 'history', collabId] as const

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? fallback)
  return json as T
}

export function useCampaignCollaborations(campaignId: string) {
  return useQuery({
    queryKey: listKey(campaignId),
    enabled: !!campaignId,
    queryFn: async () => parse<{ data: CollaborationRow[]; owners: CollaborationOwner[]; plans: CampaignPlan[] }>(
      await fetch(`/api/campaigns/${campaignId}/collaborations`), 'Error al cargar las marcas colaboradoras'),
  })
}

export function useCollaborationHistory(campaignId: string, collabId: string | null) {
  return useQuery({
    queryKey: historyKey(campaignId, collabId),
    enabled: !!collabId,
    queryFn: async () => parse<{ data: CollaborationActivity[]; has_history: boolean }>(
      await fetch(`/api/campaigns/${campaignId}/collaborations/${collabId}`), 'Error al cargar el historial'),
  })
}

export function useCollaborationCandidates(campaignId: string, q: string) {
  return useQuery({
    queryKey: ['campaign-collaborations', campaignId, 'candidates', q],
    enabled: q.trim().length >= 2,
    queryFn: async () => parse<CollaborationCandidates>(
      await fetch(`/api/campaigns/${campaignId}/collaborations/candidates?q=${encodeURIComponent(q.trim())}`), 'Error en la búsqueda'),
  })
}

export function useAddCollaboration(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (target: { lead_id?: string; brand_id?: string; plan_id?: string | null }) => parse<{ data: CollaborationRow }>(
      await fetch(`/api/campaigns/${campaignId}/collaborations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target),
      }), 'No se pudo agregar la marca'),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey(campaignId) }),
  })
}

export function useUpdateCollaboration(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) => parse<{ data: CollaborationRow }>(
      await fetch(`/api/campaigns/${campaignId}/collaborations/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      }), 'No se pudieron guardar los cambios'),
    onSuccess: ({ data }, vars) => {
      qc.setQueryData<{ data: CollaborationRow[]; owners: CollaborationOwner[]; plans: CampaignPlan[] }>(listKey(campaignId), old =>
        old ? { ...old, data: old.data.map(row => row.id === data.id ? data : row) } : old)
      qc.invalidateQueries({ queryKey: historyKey(campaignId, vars.id) })
    },
  })
}

export function useRemoveCollaboration(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => parse<{ success: true }>(
      await fetch(`/api/campaigns/${campaignId}/collaborations/${id}`, { method: 'DELETE' }), 'No se pudo quitar la marca'),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey(campaignId) }),
  })
}

// ── Planes de la campaña (catálogo propio de cada campaña) ───────────────────
export function usePlanActions(campaignId: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: listKey(campaignId) })
  const base = `/api/campaigns/${campaignId}/collaborations/plans`
  const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return {
    loadStandard: useMutation({ mutationFn: async () => parse(await fetch(base, json('POST', { standard: true })), 'No se pudo cargar el estándar'), onSuccess: refresh }),
    create: useMutation({ mutationFn: async (plan: { name: string; amount?: number | null; description?: string | null }) => parse(await fetch(base, json('POST', plan)), 'No se pudo crear el plan'), onSuccess: refresh }),
    update: useMutation({ mutationFn: async ({ id, ...patch }: { id: string; name?: string; amount?: number | null; description?: string | null }) => parse(await fetch(`${base}/${id}`, json('PATCH', patch)), 'No se pudo guardar el plan'), onSuccess: refresh }),
    remove: useMutation({ mutationFn: async (id: string) => parse(await fetch(`${base}/${id}`, { method: 'DELETE' }), 'No se pudo eliminar el plan'), onSuccess: refresh }),
  }
}

// ── Contratos (se leen de las rutas de contratos existentes; no se duplican) ──
export interface ContractSummary {
  id: string
  title: string
  status: string
  brand_id: string | null
  total_value: number | string | null
  currency: string | null
  created_at: string
  metadata: {
    package?: { name?: string | null; amount?: number | null; inclusions?: string[]; requirements?: string[]; deliverables?: string[] }
    payment_terms?: { first_percentage?: number | null; first_condition?: string | null; first_amount?: number | null; second_percentage?: number | null; second_condition?: string | null; second_amount?: number | null }
    event?: { name?: string | null; date?: string | null; start_time?: string | null; end_time?: string | null; location?: string | null }
    usage_period?: string | null
    termination_notice_days?: string | number | null
  } | null
}

export function useCampaignContracts(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['campaign-collaborations', campaignId, 'contracts'],
    enabled,
    queryFn: async () => parse<{ data: ContractSummary[] }>(await fetch(`/api/contracts?campaign_id=${campaignId}`), 'Error al cargar los contratos'),
  })
}

export function useContractContent(contractId: string | null) {
  return useQuery({
    queryKey: ['contract-content', contractId],
    enabled: !!contractId,
    queryFn: async () => parse<{ data: { content: string | null } }>(await fetch(`/api/contracts/${contractId}`), 'No se pudo cargar el contrato'),
  })
}
