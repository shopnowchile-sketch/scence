import { isInfluencerProCancellationScheduled } from '@/lib/influencer-paypal'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/server').createAdminClient>

type SubscriptionState = {
  status: string
  current_period_end: string | null
  metadata: { influencer_id?: string } | null
}

function grantsPro(subscription: SubscriptionState): boolean {
  if (subscription.status === 'active' || subscription.status === 'trialing') return true
  return subscription.status === 'canceled'
    && Boolean(subscription.current_period_end)
    && new Date(subscription.current_period_end as string).getTime() > Date.now()
}

export async function getInfluencerProIds(admin: SupabaseAdmin, influencerIds: string[]): Promise<Set<string>> {
  const statuses = await getInfluencerProStatuses(admin, influencerIds)
  return new Set(Array.from(statuses).filter(([, status]) => status !== 'free').map(([id]) => id))
}

export type InfluencerProSource = 'paid' | 'manual' | 'free'

// PostgREST arma el filtro .in(...) como querystring — con roster completo
// (miles de ids) se pasa de largo la URL. Se parte en tandas; cada tanda
// dispara las mismas 2 queries en paralelo, igual que antes.
const PRO_STATUS_BATCH_SIZE = 200

export async function getInfluencerProStatuses(admin: SupabaseAdmin, influencerIds: string[]): Promise<Map<string, InfluencerProSource>> {
  const ids = Array.from(new Set(influencerIds.filter(Boolean)))
  if (ids.length === 0) return new Map()

  const result = new Map<string, InfluencerProSource>(ids.map(id => [id, 'free']))

  for (let offset = 0; offset < ids.length; offset += PRO_STATUS_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PRO_STATUS_BATCH_SIZE)
    const [{ data, error }, { data: influencers, error: influencerError }] = await Promise.all([
      admin.from('subscriptions').select('status, current_period_end, metadata').in('metadata->>influencer_id', batch),
      admin.from('influencers').select('id, metadata').in('id', batch),
    ])

    if (error) throw error
    if (influencerError) throw influencerError

    for (const influencer of influencers ?? []) {
      const metadata = influencer.metadata as { manual_pro?: { active?: boolean } } | null
      if (metadata?.manual_pro?.active === true) result.set(influencer.id, 'manual')
    }
    for (const row of ((data ?? []) as SubscriptionState[]).filter(grantsPro)) {
      const id = row.metadata?.influencer_id
      if (id) result.set(id, 'paid')
    }
  }
  return result
}

export type InfluencerProSubscriptionDetails = {
  /** 'active' = renueva; 'canceled' = cancelada, conserva Pro hasta pro_until. */
  subscription_status: 'active' | 'canceled'
  renews: boolean
  pro_until: string | null
}

/**
 * Solo lectura para Admin: detalle de la suscripción pagada que hoy da Pro.
 * Usa el mismo criterio que getInfluencerProStatuses (grantsPro): una
 * cancelada con período vigente sigue siendo Pro; vencida no aparece acá
 * (y getInfluencerProStatuses la devuelve como 'free').
 * Si hay varias filas, la que renueva tiene prioridad sobre la cancelada.
 * Influencers sin suscripción pagada vigente (free o solo manual) no aparecen.
 */
export async function getInfluencerProSubscriptionDetails(admin: SupabaseAdmin, influencerIds: string[]): Promise<Map<string, InfluencerProSubscriptionDetails>> {
  const ids = Array.from(new Set(influencerIds.filter(Boolean)))
  const result = new Map<string, InfluencerProSubscriptionDetails>()

  for (let offset = 0; offset < ids.length; offset += PRO_STATUS_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PRO_STATUS_BATCH_SIZE)
    const { data, error } = await admin.from('subscriptions').select('status, current_period_end, metadata').in('metadata->>influencer_id', batch)
    if (error) throw error

    for (const row of ((data ?? []) as SubscriptionState[]).filter(grantsPro)) {
      const id = row.metadata?.influencer_id
      if (!id) continue
      const renews = !isInfluencerProCancellationScheduled(row)
      const candidate: InfluencerProSubscriptionDetails = {
        subscription_status: renews ? 'active' : 'canceled',
        renews,
        pro_until: row.current_period_end,
      }
      const current = result.get(id)
      if (!current) { result.set(id, candidate); continue }
      if (current.renews) continue
      const laterEnd = (candidate.pro_until ?? '') > (current.pro_until ?? '')
      if (candidate.renews || laterEnd) result.set(id, candidate)
    }
  }
  return result
}

export async function isInfluencerPro(admin: SupabaseAdmin, influencerId: string): Promise<boolean> {
  return (await getInfluencerProIds(admin, [influencerId])).has(influencerId)
}
