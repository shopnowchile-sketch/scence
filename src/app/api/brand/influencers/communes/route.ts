import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getOfficialInfluencerLocations } from '@/lib/influencer-location'
import { getBrandInfluencerScope } from '@/lib/brand-influencer-scope'

// GET /api/brand/influencers/communes
// Mismo alcance de influencers que /api/brand/influencers (getBrandInfluencerScope) — lista de comunas para poblar
// el filtro "Comuna" en /brand-influencers.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'influencer.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const brand = { id: access.brandId }

  const scope = await getBrandInfluencerScope(admin, brand.id)
  if (scope.error) return NextResponse.json({ error: scope.error }, { status: 500 })
  const influencerIds = Array.from(scope.influencerIds)
  if (influencerIds.length === 0) return NextResponse.json({ data: [] })

  const { data, error } = await admin
    .from('influencers')
    .select('id, location_id')
    .in('id', influencerIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const officialLocations = await getOfficialInfluencerLocations(admin, data ?? [])
  const labels = Array.from(officialLocations.values())
    .map(location => location.commune)
    .filter((name): name is string => Boolean(name))

  const communes = Array.from(new Set(labels))
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(label => ({ label, variants: [label] }))

  return NextResponse.json({ data: communes })
}
