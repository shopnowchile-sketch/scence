import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Barter, BarterStatus, CreateBarterInput } from '@/types'

const key = (campaignId: string) => ['barters', campaignId] as const

// ── Listar canjes de una campaña ──────────────────────────────────────────────
export function useCampaignBarters(campaignId: string) {
  return useQuery({
    queryKey: key(campaignId),
    enabled:  !!campaignId,
    queryFn:  async (): Promise<Barter[]> => {
      const res = await fetch(`/api/campaigns/${campaignId}/barters`)
      if (!res.ok) throw new Error('Error al cargar canjes')
      const json = await res.json()
      return json.data as Barter[]
    },
  })
}

// ── Crear canje ───────────────────────────────────────────────────────────────
export function useCreateBarter(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateBarterInput) => {
      const res = await fetch(`/api/campaigns/${campaignId}/barters`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear canje')
      }
      return (await res.json()).data as Barter
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(campaignId) })
      toast.success('Canje creado ✓')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Crea únicamente los registros de seguimiento para participantes aceptadas.
// Las condiciones del beneficio siempre viven en la campaña.
export function useInitializeCampaignBarters(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/barters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialize_tracking: true }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al preparar seguimiento')
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(campaignId) }),
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── Avanzar estado / editar ───────────────────────────────────────────────────
interface BarterActionInput {
  barter_id: string
  status?: BarterStatus
  note?: string
  evidence_url?: string
  patch?: Record<string, unknown>
}

export function useBarterAction(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BarterActionInput) => {
      const res = await fetch(`/api/campaigns/${campaignId}/barters`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar canje')
      }
      return (await res.json()).data as Barter
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(campaignId) }),
    onError:   (e: Error) => toast.error(e.message),
  })
}

export function useBulkBenefitStatus(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: Array<{ barter_id: string; benefit_index: number; status: 'pending' | 'completed' | 'problem' }>) => {
      const res = await fetch(`/api/campaigns/${campaignId}/barters`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk_benefit_updates: updates }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al actualizar canjes')
      return json.data as { updated: number }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(campaignId) }),
    onError: (error: Error) => toast.error(error.message),
  })
}

// ── Eliminar canje ────────────────────────────────────────────────────────────
export function useDeleteBarter(campaignId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (barterId: string) => {
      const res = await fetch(
        `/api/campaigns/${campaignId}/barters?barter_id=${barterId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al eliminar canje')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(campaignId) })
      toast.success('Canje eliminado')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
