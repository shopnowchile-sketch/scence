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
  return new Set([...statuses].filter(([, status]) => status !== 'free').map(([id]) => id))
}

export type InfluencerProSource = 'paid' | 'manual' | 'free'

export async function getInfluencerProStatuses(admin: SupabaseAdmin, influencerIds: string[]): Promise<Map<string, InfluencerProSource>> {
  const ids = [...new Set(influencerIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const [{ data, error }, { data: influencers, error: influencerError }] = await Promise.all([
    admin.from('subscriptions').select('status, current_period_end, metadata').in('metadata->>influencer_id', ids),
    admin.from('influencers').select('id, metadata').in('id', ids),
  ])

  if (error) throw error
  if (influencerError) throw influencerError

  const result = new Map<string, InfluencerProSource>(ids.map(id => [id, 'free']))
  for (const influencer of influencers ?? []) {
    const metadata = influencer.metadata as { manual_pro?: { active?: boolean } } | null
    if (metadata?.manual_pro?.active === true) result.set(influencer.id, 'manual')
  }
  for (const row of ((data ?? []) as SubscriptionState[]).filter(grantsPro)) {
    const id = row.metadata?.influencer_id
    if (id) result.set(id, 'paid')
  }
  return result
}

export async function isInfluencerPro(admin: SupabaseAdmin, influencerId: string): Promise<boolean> {
  return (await getInfluencerProIds(admin, [influencerId])).has(influencerId)
}
