import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { hardDeleteInfluencers } from '@/lib/influencers/hardDelete'
import { isOrgAdmin } from '@/lib/influencers/authz'

type Params = { params: { id: string } }

async function canManageInfluencer(admin: ReturnType<typeof createAdminClient>, userId: string, influencerId: string) {
  const { data: influencer } = await admin
    .from('influencers')
    .select('id, user_id, organization_id')
    .eq('id', influencerId)
    .maybeSingle()

  if (!influencer) return { allowed: false, influencer: null }
  if (influencer.user_id === userId) return { allowed: true, influencer }

  const orgId = await getOrgId(userId, undefined, admin)
  const allowed = !!orgId && influencer.organization_id === orgId && await isOrgAdmin(admin, userId, orgId)
  return { allowed, influencer }
}

// ── GET /api/influencers/[id] ─────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const access = await canManageInfluencer(admin, user.id, params.id)
  if (!access.influencer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = access.influencer.organization_id
  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  // Core influencer + social profiles + rate cards
  const { data: influencer, error } = await admin
    .from('influencers')
    .select(`
      *,
      social_profiles:influencer_social_profiles (*),
      rate_cards:influencer_rate_cards (*)
    `)
    .eq('id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[GET /api/influencers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Campaigns via campaign_influencers
  const { data: campaignInfluencers } = await admin
    .from('campaign_influencers')
    .select(`
      id, fee, status, created_at,
      campaign:campaigns (id, name, status, start_date, end_date, type, platforms)
    `)
    .eq('influencer_id', params.id)

  // Deliverables — fetch via influencer_id OR via campaign_influencers join
  const ciIds = (campaignInfluencers ?? []).map((ci: Record<string,unknown>) => ci.id as string).filter(Boolean)
  let delivQuery = admin
    .from('campaign_deliverables')
    .select(`id, title, type, status, due_date, platform, created_at, submitted_at, published_at, updated_at, description, progress, content_url, campaign:campaigns (id, name)`)
    .eq('influencer_id', params.id)

  if (ciIds.length > 0) {
    delivQuery = admin
      .from('campaign_deliverables')
      .select(`id, title, type, status, due_date, platform, created_at, submitted_at, published_at, updated_at, description, progress, content_url, campaign:campaigns (id, name)`)
      .or(`influencer_id.eq.${params.id},campaign_influencer_id.in.(${ciIds.join(',')})`)
  }

  const { data: campaignDeliverables } = await delivQuery

  const [bartersRes, directBookingsRes, linkedBookingsRes, conversionsRes, settlementsRes] = await Promise.all([
    admin
      .from('barters')
      .select('id, item, simple_status, created_at, completed_at, cancelled_at, campaign:campaigns(id, name)')
      .eq('organization_id', orgId)
      .eq('influencer_id', params.id),
    admin
      .from('bookings')
      .select('id, title, status, starts_at, confirmed_at, canceled_at, campaign:campaigns(id, name)')
      .eq('organization_id', orgId)
      .eq('influencer_id', params.id),
    admin
      .from('booking_influencers')
      .select(`
        id, status, created_at,
        booking:bookings!inner (
          id, title, status, starts_at, confirmed_at, canceled_at, organization_id,
          campaign:campaigns (id, name)
        )
      `)
      .eq('influencer_id', params.id)
      .eq('booking.organization_id', orgId),
    admin
      .from('affiliate_conversions')
      .select('id, status, sale_amount, commission_amount, currency, occurred_at, confirmed_at, campaign:campaigns(id, name)')
      .eq('organization_id', orgId)
      .eq('influencer_id', params.id),
    admin
      .from('commission_settlements')
      .select('id, status, amount, currency, created_at, paid_at, campaign:campaigns(id, name)')
      .eq('organization_id', orgId)
      .eq('influencer_id', params.id),
  ])

  const bookings = [...(directBookingsRes.data ?? [])]
  const seenBookingIds = new Set(bookings.map(booking => booking.id))
  for (const row of linkedBookingsRes.data ?? []) {
    const booking = row.booking as unknown as Record<string, unknown> | null
    const bookingId = booking?.id as string | undefined
    if (!bookingId || seenBookingIds.has(bookingId)) continue
    seenBookingIds.add(bookingId)
    bookings.push({ ...booking, participant_status: row.status } as never)
  }

  return NextResponse.json({
    data: {
      ...influencer,
      campaign_influencers: campaignInfluencers ?? [],
      campaign_deliverables: campaignDeliverables ?? [],
      barters: bartersRes.data ?? [],
      bookings,
      affiliate_conversions: conversionsRes.data ?? [],
      commission_settlements: settlementsRes.data ?? [],
    }
  })
}

// ── PUT /api/influencers/[id] — full update ───────────────────────────────────
export async function PUT(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Destructure all known non-column fields so rest only has valid DB columns
  const {
    id: _id, created_at: _ca, created_by: _cb, organization_id: _oi,
    social_profiles, rate_cards, campaign_influencers: _ci, deliverables: _d,
    // Form-only fields that don't exist as columns → store in metadata
    first_name, last_name, deactivation_reason, status: influencerStatus,
    // Strip any other relation fields
    campaign_deliverables: _cd,
    ...rest
  } = body

  // Merge non-column fields into metadata
  const metaUpdate: Record<string, unknown> = {}
  if (first_name         !== undefined) metaUpdate.first_name         = first_name
  if (last_name          !== undefined) metaUpdate.last_name          = last_name
  if (deactivation_reason !== undefined) metaUpdate.deactivation_reason = deactivation_reason
  if (influencerStatus   !== undefined) metaUpdate.status             = influencerStatus

  const admin = createAdminClient()
  const access = await canManageInfluencer(admin, user.id, params.id)
  if (!access.influencer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Merge metadata with existing (don't overwrite)
  let mergedMeta = metaUpdate
  if (Object.keys(metaUpdate).length > 0) {
    const { data: cur } = await admin.from('influencers').select('metadata').eq('id', params.id).single()
    mergedMeta = { ...(cur?.metadata as Record<string,unknown> ?? {}), ...metaUpdate }
  }

  const { data, error } = await admin
    .from('influencers')
    .update({
      ...rest,
      ...(Object.keys(mergedMeta).length > 0 ? { metadata: mergedMeta } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select('*, influencer_social_profiles(*), influencer_rate_cards(*)')
    .single()

  if (error) {
    console.error('[PUT /api/influencers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Replace social profiles if provided
  // Normalize: form sends followers_count → DB column is followers
  if (Array.isArray(social_profiles)) {
    await admin.from('influencer_social_profiles').delete().eq('influencer_id', params.id)
    if ((social_profiles as unknown[]).length > 0) {
      const { error: spErr } = await admin.from('influencer_social_profiles').insert(
        (social_profiles as Array<Record<string, unknown>>).map(({ followers_count, id: _sid, ...sp }) => ({
          ...sp,
          followers: Number(followers_count ?? sp.followers ?? 0),
          influencer_id: params.id,
        }))
      )
      if (spErr) {
        console.error('[PUT /api/influencers/[id]] social_profiles:', spErr)
        return NextResponse.json({ error: `Error guardando redes sociales: ${spErr.message}` }, { status: 500 })
      }
    }
  }

  // Replace rate cards if provided
  // Normalize: form sends service_type → DB column is deliverable_type
  if (Array.isArray(rate_cards)) {
    await admin.from('influencer_rate_cards').delete().eq('influencer_id', params.id)
    if ((rate_cards as unknown[]).length > 0) {
      const { error: rcErr } = await admin.from('influencer_rate_cards').insert(
        (rate_cards as Array<Record<string, unknown>>).map(({ service_type, id: _rid, ...rc }) => ({
          ...rc,
          deliverable_type: (service_type as string) ?? rc.deliverable_type,
          influencer_id: params.id,
        }))
      )
      if (rcErr) {
        console.error('[PUT /api/influencers/[id]] rate_cards:', rcErr)
        return NextResponse.json({ error: `Error guardando tarifas: ${rcErr.message}` }, { status: 500 })
      }
    }
  }

  // Re-fetch with updated relations so response is fresh
  const { data: fresh } = await admin
    .from('influencers')
    .select('*, social_profiles:influencer_social_profiles(*), rate_cards:influencer_rate_cards(*)')
    .eq('id', params.id)
    .single()

  return NextResponse.json({ data: fresh ?? data })
}

// ── PATCH /api/influencers/[id] — partial update ──────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = createAdminClient()
  const access = await canManageInfluencer(admin, user.id, params.id)
  if (!access.influencer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Campos que no son columnas reales → van dentro de metadata JSONB
  const META_FIELDS = ['deactivation_reason', 'first_name', 'last_name', 'status']
  const metaPatch: Record<string, unknown> = {}
  const columnPatch: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(body)) {
    if (META_FIELDS.includes(k)) metaPatch[k] = v
    else columnPatch[k] = v
  }

  // Si hay campos de metadata, hacer merge con el metadata existente
  let metadataUpdate: Record<string, unknown> | undefined
  if (Object.keys(metaPatch).length > 0) {
    const { data: existing } = await admin
      .from('influencers').select('metadata').eq('id', params.id).single()
    metadataUpdate = { ...(existing?.metadata ?? {}), ...metaPatch }
  }

  const { data, error } = await admin
    .from('influencers')
    .update({
      ...columnPatch,
      ...(metadataUpdate ? { metadata: metadataUpdate } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error('[PATCH /api/influencers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── DELETE /api/influencers/[id] ─────────────────────────────────────────────
// Default: soft delete (desactiva). Con ?hard=true → borrado permanente (cascada).
export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const access = await canManageInfluencer(admin, user.id, params.id)
  if (!access.influencer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const hard = new URL(req.url).searchParams.get('hard') === 'true'

  // ── Borrado permanente ─────────────────────────────────────────────────────
  if (hard) {
    const orgId = await getOrgId(user.id, user.user_metadata, admin)
    if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
    if (!(await isOrgAdmin(admin, user.id, orgId))) {
      return NextResponse.json({ error: 'Solo administradores pueden eliminar permanentemente.' }, { status: 403 })
    }
    try {
      const result = await hardDeleteInfluencers(admin, orgId, [params.id])
      if (result.deleted === 0) {
        return NextResponse.json({ error: 'Influencer no encontrado en tu organización' }, { status: 404 })
      }
      return NextResponse.json({ success: true, deleted: result.deleted, hard: true, childErrors: result.childErrors })
    } catch (e) {
      console.error('[DELETE hard /api/influencers/[id]]', e)
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Error al borrar' }, { status: 500 })
    }
  }

  // ── Soft delete (desactiva) ─────────────────────────────────────────────────
  const { error } = await admin
    .from('influencers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) {
    console.error('[DELETE /api/influencers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, hard: false })
}
