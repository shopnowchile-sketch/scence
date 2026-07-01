import type { SupabaseClient } from '@supabase/supabase-js'

export type SubscriptionPlan = {
  id: string
  tier: string
  name: string
  description: string | null
  price_monthly: number
  price_yearly: number | null
  max_users: number | null
  max_campaigns: number | null
  max_influencers: number | null
  features: string[]
  is_active: boolean
  stripe_price_id_monthly: string | null
  stripe_price_id_yearly: string | null
}

export async function getActivePlans(admin: SupabaseClient): Promise<SubscriptionPlan[]> {
  const { data, error } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('price_monthly', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as SubscriptionPlan[]
}

export async function getOrgSubscription(admin: SupabaseClient, organizationId: string) {
  const { data } = await admin
    .from('subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}
