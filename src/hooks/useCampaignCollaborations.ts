import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CollaborationActivity, CollaborationRow } from '@/lib/campaign-collaborations-shared'

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
    queryFn: async () => parse<{ data: CollaborationRow[]; owners: CollaborationOwner[] }>(
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
    mutationFn: async (target: { lead_id?: string; brand_id?: string }) => parse<{ data: CollaborationRow }>(
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
      qc.setQueryData<{ data: CollaborationRow[]; owners: CollaborationOwner[] }>(listKey(campaignId), old =>
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
