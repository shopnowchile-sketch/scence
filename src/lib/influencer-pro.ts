import { influencerSubscriptionGrantsPro, isInfluencerProCancellationScheduled, selectOrphanSubscriptionsToRelink } from '@/lib/influencer-paypal'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/server').createAdminClient>

type SubscriptionState = {
  status: string
  current_period_end: string | null
  metadata: { influencer_id?: string } | null
}

// Regla única (active/trialing, o canceled con período vigente): ver influencerSubscriptionGrantsPro.
const grantsPro = (subscription: SubscriptionState) => influencerSubscriptionGrantsPro(subscription)

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

/**
 * Re-vincula a la ficha actual las suscripciones Pro del mismo usuario cuya
 * ficha original ya no existe (borrada y recreada). Identidad estable:
 * `subscriptions.metadata.user_id` = `influencers.user_id` (auth).
 *
 * Seguro por construcción: solo toca filas del mismo usuario y solo si la
 * ficha a la que apuntan no existe (selectOrphanSubscriptionsToRelink). Los
 * pagos de esas suscripciones que quedaron sin vínculo (FK SET NULL) se
 * re-vinculan también. Idempotente. Devuelve cuántas suscripciones movió.
 */
export async function reconcileOrphanProSubscriptions(
  admin: SupabaseAdmin,
  influencer: { id: string; user_id: string | null },
): Promise<number> {
  if (!influencer.user_id) return 0
  const { data: rows, error } = await admin
    .from('subscriptions')
    .select('id, metadata')
    .eq('metadata->>user_id', influencer.user_id)
  if (error) throw error
  if (!rows?.length) return 0

  const linkedIds = Array.from(new Set(rows
    .map(row => (row.metadata as { influencer_id?: string } | null)?.influencer_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)))
  const { data: existing, error: existingError } = linkedIds.length
    ? await admin.from('influencers').select('id').in('id', linkedIds)
    : { data: [], error: null }
  if (existingError) throw existingError

  const toRelink = selectOrphanSubscriptionsToRelink(rows, new Set((existing ?? []).map(row => row.id)), influencer.id)
  const now = new Date().toISOString()
  for (const id of toRelink) {
    const row = rows.find(candidate => candidate.id === id)!
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    const { error: updateError } = await admin.from('subscriptions').update({
      metadata: { ...metadata, influencer_id: influencer.id, relinked_from: metadata.influencer_id, relinked_at: now },
      updated_at: now,
    }).eq('id', id).eq('metadata->>influencer_id', String(metadata.influencer_id))
    if (updateError) throw updateError
    const { error: paymentsError } = await admin.from('subscription_payments')
      .update({ influencer_id: influencer.id, updated_at: now })
      .eq('subscription_id', id)
      .is('influencer_id', null)
    if (paymentsError) throw paymentsError
    console.info('[influencer-pro] suscripción Pro re-vinculada a la ficha actual', { subscriptionId: id, from: metadata.influencer_id, to: influencer.id })
  }
  return toRelink.length
}
