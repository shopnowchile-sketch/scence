import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/bookings — bookings asignados a esta influencer
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const { data: acceptedRows, error: acceptedError } = await admin
    .from('campaign_influencers')
    .select('campaign_id')
    .eq('influencer_id', influencer.id)
    .eq('application_status', 'accepted')
  if (acceptedError) return NextResponse.json({ error: acceptedError.message }, { status: 500 })
  const acceptedCampaignIds = new Set((acceptedRows ?? []).map(row => row.campaign_id as string))

  // Buscar en booking_influencers (multi-influencer)
  // Nota (fix B-06): `bookings` no tiene FK directa a `brands` — la marca se
  // alcanza vía bookings.campaign_id -> campaigns.brand_id -> brands.id.
  // Por eso `brand` se anida dentro de `campaign` en el select y se
  // "aplana" de vuelta a nivel superior en flattenBrand(), para no tener
  // que tocar el frontend (que espera `booking.brand` como campo propio).
  const { data: biRows, error: biErr } = await admin
    .from('booking_influencers')
    .select(`
      id, status,
      booking:bookings (
        id, title, description, status, starts_at, ends_at, location, metadata,
        campaign:campaigns (id, name, brand:brands!brand_id (id, name, logo_url))
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })

  if (biErr) return NextResponse.json({ error: biErr.message }, { status: 500 })

  // También buscar bookings directos (campo legacy influencer_id en bookings)
  const { data: directRows } = await admin
    .from('bookings')
    .select(`
      id, title, description, status, starts_at, ends_at, location, metadata,
      campaign:campaigns (id, name, brand:brands!brand_id (id, name, logo_url))
    `)
    .eq('influencer_id', influencer.id)
    .order('starts_at', { ascending: false })

  type CampaignWithBrand = { id: string; name: string; brand?: { id: string; name: string; logo_url: string | null } | null } | null

  function flattenBrand(row: Record<string, unknown>): Record<string, unknown> {
    const campaign = row.campaign as CampaignWithBrand
    const metadata = row.metadata as Record<string, unknown> | null
    return {
      ...row,
      campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      brand: campaign?.brand ?? null,
      google_calendar_link: typeof metadata?.google_calendar_link === 'string' ? metadata.google_calendar_link : null,
    }
  }

  // Merge y dedup por booking id
  const seen = new Set<string>()
  const merged: Record<string, unknown>[] = []

  for (const row of biRows ?? []) {
    const b = row.booking as unknown as Record<string, unknown> | null
    if (!b) continue
    const campaignId = (b.campaign as CampaignWithBrand)?.id
    if (campaignId && !acceptedCampaignIds.has(campaignId)) continue
    if (!b.starts_at || !b.ends_at) continue
    const bid = b.id as string
    if (seen.has(bid)) continue
    seen.add(bid)
    merged.push({ ...flattenBrand(b), my_status: row.status })
  }

  for (const b of directRows ?? []) {
    const campaignId = (b.campaign as unknown as CampaignWithBrand)?.id
    if (campaignId && !acceptedCampaignIds.has(campaignId)) continue
    if (!b.starts_at || !b.ends_at) continue
    if (seen.has(b.id)) continue
    seen.add(b.id)
    merged.push({ ...flattenBrand(b as unknown as Record<string, unknown>), my_status: b.status })
  }

  // Ordenar por starts_at
  merged.sort((a, b) => {
    const da = new Date((a.starts_at as string) ?? 0).getTime()
    const db = new Date((b.starts_at as string) ?? 0).getTime()
    return da - db
  })

  return NextResponse.json({ data: merged })
}
