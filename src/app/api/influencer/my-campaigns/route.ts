import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCampaignCoverUrls } from '@/lib/campaign-cover'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getInfluencer(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('influencers')
    .select('id, organization_id')
    .eq('user_id', userId)
    .single()
  return data
}

// ── GET /api/influencer/my-campaigns ─────────────────────────────────────────
// Returns campaigns this influencer is assigned to via campaign_influencers,
// PLUS campaigns they created themselves (created_by = user, type influencer_self).
// Uses the real campaigns table — single source of truth.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const influencer = await getInfluencer(user.id)
  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  // Campaigns assigned via campaign_influencers (from admin/brand)
  // NOTA: "brief" NO es columna de campaigns (solo existe brief_url, que es
  // otra cosa) — se sacó del select porque rompía la query completa
  // silenciosamente (bug real detectado por Pri: no aparecía NINGUNA
  // campaña asignada, ver 2026-07-05).
  const { data: assigned, error: assignedError } = await admin
    .from('campaign_influencers')
    .select(`
      id, status, application_status, origin, message, fee, currency, application_answers, metadata,
      campaign:campaigns (
        id, name, status, description, content_guidelines, hashtags, platforms,
        start_date, end_date, currency, created_by, visibility, application_questions,
        brand:brands!brand_id (id, name, logo_url, website, instagram, contact_name, contact_email),
        campaign_brands (
          id, role,
          brand:brands (id, name, logo_url, website, instagram)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, published_url, submitted_at, description, hashtags, tag_brand_ids, tag_handles,
        attendance_response, attendance_responded_at, attendance_note,
        attendance_outcome, attendance_outcome_at
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })
  if (assignedError) console.error('[GET /api/influencer/my-campaigns] assigned query failed:', assignedError)

  // Campaigns created by the influencer themselves
  const { data: selfCreated, error: selfCreatedError } = await admin
    .from('campaigns')
    .select(`
      id, name, status, description, content_guidelines, hashtags, platforms,
      start_date, end_date, currency, budget_total, created_by,
      brand:brands!brand_id (id, name, logo_url, website, instagram, contact_name, contact_email),
      campaign_brands (
        id, role,
        brand:brands (id, name, logo_url, website, instagram)
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, published_url, submitted_at, description, hashtags, tag_brand_ids, tag_handles,
        attendance_response, attendance_responded_at, attendance_note,
        attendance_outcome, attendance_outcome_at
      )
    `)
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
  if (selfCreatedError) console.error('[GET /api/influencer/my-campaigns] selfCreated query failed:', selfCreatedError)

  // Preasignación en draft: las campañas asignadas que aún son borrador (o
  // están en revisión) NO son visibles para la influencer hasta que la marca
  // las active. Se filtran acá (gate por campaign.status). Las self-created
  // (creadas por la propia influencer) no se tocan.
  const HIDDEN_ASSIGNED_STATUSES = new Set(['draft', 'pending_approval'])
  const visibleAssigned = (assigned ?? []).filter((ci: Record<string, unknown>) => {
    const camp = ci.campaign as Record<string, unknown> | null
    return !HIDDEN_ASSIGNED_STATUSES.has(String(camp?.status ?? ''))
  })

  // Rechazadas sin participación real: si la postulación/invitación quedó
  // 'rejected' y no tiene deliverables, booking, contrato ni pago asociado,
  // ya no debe aparecer en el portal ni contar como historial (pedido de
  // Pri 2026-07-13 — "no debe quedar en el historial si solo postuló").
  // Si SÍ hubo participación real, la fila se mantiene visible (el label
  // se ajusta en inf-campaigns/page.tsx a "Te invitamos a la próxima").
  // No se borra ni modifica nada en la base — Admin y Marca siguen viendo
  // la fila completa en campaign_influencers.
  const rejectedNoDeliverables = visibleAssigned.filter((ci: Record<string, unknown>) => {
    const del = (ci.campaign_deliverables as unknown[]) ?? []
    return ci.application_status === 'rejected' && del.length === 0
  })

  let contractedIds = new Set<string>()
  let invoicedIds   = new Set<string>()
  let bookedCampaignIds = new Set<string>()

  if (rejectedNoDeliverables.length > 0) {
    const ciIds = rejectedNoDeliverables
      .map((ci: Record<string, unknown>) => ci.id)
      .filter(Boolean) as string[]
    const campaignIds = rejectedNoDeliverables
      .map((ci: Record<string, unknown>) => (ci.campaign as Record<string, unknown> | null)?.id)
      .filter(Boolean) as string[]

    const [contractsRes, invoiceItemsRes, bookingsRes] = await Promise.all([
      ciIds.length
        ? admin.from('contracts').select('campaign_influencer_id').in('campaign_influencer_id', ciIds)
        : Promise.resolve({ data: [] as Array<{ campaign_influencer_id: string | null }> }),
      ciIds.length
        ? admin.from('invoice_line_items').select('campaign_influencer_id').in('campaign_influencer_id', ciIds)
        : Promise.resolve({ data: [] as Array<{ campaign_influencer_id: string | null }> }),
      campaignIds.length
        ? admin.from('bookings').select('campaign_id').eq('influencer_id', influencer.id).in('campaign_id', campaignIds)
        : Promise.resolve({ data: [] as Array<{ campaign_id: string | null }> }),
    ])

    contractedIds = new Set(
      (contractsRes.data ?? []).map((r: { campaign_influencer_id: string | null }) => r.campaign_influencer_id).filter(Boolean) as string[]
    )
    invoicedIds = new Set(
      (invoiceItemsRes.data ?? []).map((r: { campaign_influencer_id: string | null }) => r.campaign_influencer_id).filter(Boolean) as string[]
    )
    bookedCampaignIds = new Set(
      (bookingsRes.data ?? []).map((r: { campaign_id: string | null }) => r.campaign_id).filter(Boolean) as string[]
    )
  }

  const visibleAssignedFiltered = visibleAssigned.filter((ci: Record<string, unknown>) => {
    const del = (ci.campaign_deliverables as unknown[]) ?? []
    if (ci.application_status !== 'rejected' || del.length > 0) return true
    const ciId   = ci.id as string
    const campId = (ci.campaign as Record<string, unknown> | null)?.id as string | undefined
    return contractedIds.has(ciId) || invoicedIds.has(ciId) || (!!campId && bookedCampaignIds.has(campId))
  })

  // Las marcas colaboradoras y sus handles forman parte del brief operativo.
  // No se exponen a quien todavía está postulando o debe aceptar una invitación.
  const assignedWithAllowedBrands = visibleAssignedFiltered.map((row: Record<string, unknown>) => {
    if (row.application_status === 'accepted') return row
    const campaign = row.campaign as Record<string, unknown> | null
    return { ...row, campaign: campaign ? { ...campaign, campaign_brands: [] } : campaign }
  })

  // Merge: assigned from admin + self-created
  // Self-created are wrapped to match the assigned shape
  const assignedIds = new Set(visibleAssignedFiltered.map((ci: Record<string, unknown>) => {
    const camp = ci.campaign as Record<string, unknown> | null
    return camp?.id
  }))

  const selfWrapped = (selfCreated ?? [])
    .filter((c: Record<string, unknown>) => !assignedIds.has(c.id))
    .map((c: Record<string, unknown>) => ({
      id: null,
      status: c.status,
      fee: null,
      currency: c.currency,
      campaign: c,
      campaign_deliverables: (c.campaign_deliverables as unknown[]) ?? [],
      _self_created: true,
    }))

  const merged = [...assignedWithAllowedBrands, ...selfWrapped]

  const covers = await getCampaignCoverUrls(admin, merged
    .map((row: Record<string, unknown>) => (row.campaign as Record<string, unknown> | null)?.id)
    .filter(Boolean) as string[])
  for (const row of merged as Array<Record<string, unknown>>) {
    const campaign = row.campaign as Record<string, unknown> | null
    if (campaign?.id) campaign.cover_url = covers.get(campaign.id as string) ?? null
  }

  // Fecha, hora y lugar del evento viven en `bookings`, que también alimenta
  // el calendario. La fecha/hora se muestran antes de aprobar; dirección e
  // instrucciones son operativas y solo se revelan a la influencer aceptada.
  const campaignIds = merged
    .map((row: Record<string, unknown>) => (row.campaign as Record<string, unknown> | null)?.id)
    .filter(Boolean) as string[]

  if (campaignIds.length > 0) {
    const [directBookings, linkedBookings, campaignEvents] = await Promise.all([
      admin
        .from('bookings')
        .select('id, campaign_id, title, starts_at, ends_at, location, location_details, status')
        .eq('influencer_id', influencer.id)
        .in('campaign_id', campaignIds)
        .order('starts_at', { ascending: true }),
      admin
        .from('booking_influencers')
        .select('booking:bookings (id, campaign_id, title, starts_at, ends_at, location, location_details, status)')
        .eq('influencer_id', influencer.id),
      admin
        .from('bookings')
        .select('id, campaign_id, title, starts_at, ends_at, location, location_details, status')
        .in('campaign_id', campaignIds)
        .is('influencer_id', null)
        .order('starts_at', { ascending: true }),
    ])

    const byCampaign = new Map<string, Record<string, unknown>>()
    for (const booking of directBookings.data ?? []) {
      if (booking.campaign_id && !byCampaign.has(booking.campaign_id)) {
        byCampaign.set(booking.campaign_id, booking as Record<string, unknown>)
      }
    }
    for (const row of linkedBookings.data ?? []) {
      const booking = row.booking as unknown as Record<string, unknown> | null
      const campaignId = booking?.campaign_id as string | null | undefined
      if (booking && campaignId && campaignIds.includes(campaignId) && !byCampaign.has(campaignId)) {
        byCampaign.set(campaignId, booking)
      }
    }

    const campaignEventByCampaign = new Map<string, Record<string, unknown>>()
    for (const booking of campaignEvents.data ?? []) {
      if (booking.campaign_id && !campaignEventByCampaign.has(booking.campaign_id)) {
        campaignEventByCampaign.set(booking.campaign_id, booking as Record<string, unknown>)
      }
    }

    for (const row of merged as Array<Record<string, unknown>>) {
      const campaign = row.campaign as Record<string, unknown> | null
      if (!campaign?.id) continue
      const booking = byCampaign.get(campaign.id as string) ?? campaignEventByCampaign.get(campaign.id as string)
      if (!booking) continue
      // La dirección permite a la influencer decidir si puede asistir. Brief y
      // materiales privados continúan protegidos por el estado de aceptación.
      row.event_booking = booking
    }
  }

  return NextResponse.json({ data: merged })
}

// ── POST /api/influencer/my-campaigns ────────────────────────────────────────
// Creates a campaign in the real campaigns table.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const influencer = await getInfluencer(user.id)
  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const body = await req.json()
  const { name, brand_id, start_date, end_date, description, fee, currency = 'CLP' } = body
  if (!name) return NextResponse.json({ error: 'name requerido' }, { status: 400 })

  // Require an organization to assign the campaign to
  const orgId = influencer.organization_id
  if (!orgId) return NextResponse.json({ error: 'El influencer no pertenece a una organización' }, { status: 400 })

  const { data: newCampaign, error: campErr } = await admin
    .from('campaigns')
    .insert({
      name,
      organization_id: orgId,
      created_by: user.id,
      description: description ?? null,
      brand_id: brand_id ?? null,
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      currency,
      status: 'active',
      type: 'sponsored_post',
    })
    .select('*, brand:brands!brand_id(id, name, logo_url, website, contact_name, contact_email)')
    .single()

  if (campErr) {
    console.error('[POST /api/influencer/my-campaigns]', campErr)
    return NextResponse.json({ error: campErr.message }, { status: 500 })
  }

  // Also link this influencer to the campaign
  await admin.from('campaign_influencers').insert({
    campaign_id: newCampaign.id,
    influencer_id: influencer.id,
    fee: fee ?? null,
    currency,
    status: 'active',
  })

  return NextResponse.json({
    data: {
      id: null,
      status: newCampaign.status,
      fee: fee ?? null,
      currency,
      campaign: newCampaign,
      campaign_deliverables: [],
      _self_created: true,
    }
  }, { status: 201 })
}

// ── PATCH /api/influencer/my-campaigns ───────────────────────────────────────
// Updates a campaign the influencer created (only their own self-created ones).
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const influencer = await getInfluencer(user.id)
  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const body = await req.json()
  const { id, deliverables, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  // Verify this campaign was created by this user
  const { data: existing } = await admin
    .from('campaigns')
    .select('id, created_by')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (existing.created_by !== user.id) return NextResponse.json({ error: 'Sin permiso para editar esta campaña' }, { status: 403 })

  // Allowed fields to update
  const allowed = ['name', 'description', 'start_date', 'end_date', 'currency', 'brand_id', 'status']
  const updatePayload: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) updatePayload[key] = updates[key]
  }

  if (Object.keys(updatePayload).length > 0) {
    await admin.from('campaigns').update(updatePayload).eq('id', id)
  }

  // Handle deliverables update (upsert/delete by id)
  if (Array.isArray(deliverables)) {
    for (const d of deliverables) {
      if (!d.id) {
        // New deliverable
        await admin.from('campaign_deliverables').insert({
          campaign_id: id,
          influencer_id: influencer.id,
          title: d.title ?? null,
          type: d.type ?? 'instagram_post',
          platform: d.platform ? d.platform.toLowerCase() : null,
          due_date: d.due_date ?? null,
          scheduled_at: d.scheduled_at ?? null,
          sequence_number: d.sequence_number ?? null,
          description: d.description ?? null,
          status: d.status ?? 'pending',
          content_url: d.content_url ?? null,
        })
      } else if (d._delete) {
        await admin.from('campaign_deliverables').delete().eq('id', d.id).eq('campaign_id', id)
      } else {
        const delUpdate: Record<string, unknown> = {}
        if ('title' in d) delUpdate.title = d.title
        if ('status' in d) delUpdate.status = d.status
        if ('content_url' in d) delUpdate.content_url = d.content_url
        if ('due_date' in d) delUpdate.due_date = d.due_date
        if ('scheduled_at' in d) delUpdate.scheduled_at = d.scheduled_at
        if ('sequence_number' in d) delUpdate.sequence_number = d.sequence_number
        if ('description' in d) delUpdate.description = d.description
        if (Object.keys(delUpdate).length > 0) {
          await admin.from('campaign_deliverables').update(delUpdate).eq('id', d.id).eq('campaign_id', id)
        }
      }
    }
  }

  // Return refreshed campaign data
  const { data: refreshed } = await admin
    .from('campaigns')
    .select(`
      id, name, status, description, start_date, end_date, currency, created_by,
      brand:brands!brand_id(id, name, logo_url, website, contact_name, contact_email),
      campaign_deliverables(id, title, type, status, due_date, scheduled_at, sequence_number, platform, content_url, description, hashtags, tag_brand_ids, tag_handles)
    `)
    .eq('id', id)
    .single()

  return NextResponse.json({
    data: {
      id: null,
      status: refreshed?.status,
      fee: null,
      currency: refreshed?.currency,
      campaign: refreshed,
      campaign_deliverables: refreshed?.campaign_deliverables ?? [],
      _self_created: true,
    }
  })
}

// ── DELETE /api/influencer/my-campaigns ──────────────────────────────────────
// Cancels (soft-delete) a self-created campaign.
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const influencer = await getInfluencer(user.id)
  if (!influencer) return NextResponse.json({ error: 'Not an influencer' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  // Only allow canceling own campaigns
  const { data: existing } = await admin
    .from('campaigns')
    .select('id, created_by')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (existing.created_by !== user.id) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })

  await admin.from('campaigns').update({ status: 'canceled' }).eq('id', id)
  return NextResponse.json({ ok: true })
}
