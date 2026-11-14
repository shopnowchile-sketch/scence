import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

export const SHIPPING_COLUMNS = 'id, name, address, parent_id, is_primary, is_active, notes'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/**
 * Autorización única de /api/influencer/shipping-addresses*: solo la propia influencer.
 * El dueño sale de la sesión (influencers.user_id), nunca del body. Son places privados
 * `influencer_home` en `locations`; las marcas no tienen ninguna ruta que los lea.
 */
export async function authorizeInfluencerShipping(): Promise<
  { res: NextResponse } | { admin: SupabaseClient; influencerId: string; organizationId: string }
> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: inf } = await admin
    .from('influencers').select('id, organization_id').eq('user_id', user.id).maybeSingle()
  if (!inf?.organization_id) return { res: NextResponse.json({ error: 'Perfil de influencer no encontrado' }, { status: 404 }) }
  return { admin, influencerId: inf.id as string, organizationId: inf.organization_id as string }
}

/** Deja `keepId` como única principal activa de la influencer (sin borrar las demás). */
export async function setPrimaryShipping(admin: SupabaseClient, influencerId: string, keepId: string) {
  const { error: e1 } = await admin.from('locations').update({ is_primary: false })
    .eq('owner_influencer_id', influencerId).eq('is_primary', true).neq('id', keepId)
  if (e1) return e1
  const { error: e2 } = await admin.from('locations').update({ is_primary: true })
    .eq('id', keepId).eq('owner_influencer_id', influencerId)
  return e2
}
