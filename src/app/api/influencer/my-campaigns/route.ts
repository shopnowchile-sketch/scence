import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

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
  const { data: assigned } = await admin
    .from('campaign_influencers')
    .select(`
      id, status, fee, currency,
      campaign:campaigns (
        id, name, status, description, start_date, end_date,
        currency, created_by,
        brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email)
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, submitted_at
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })

  // Campaigns created by the influencer themselves
  const { data: selfCreated } = await admin
    .from('campaigns')
    .select(`
      id, name, status, description, start_date, end_date,
      currency, budget_total, created_by,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email),
      campaign_deliverables (
        id, title, type, status, due_date, platform, content_url, submitted_at
      )
    `)
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  // Merge: assigned from admin + self-created
  // Self-created are wrapped to match the assigned shape
  const assignedIds = new Set((assigned ?? []).map((ci: Record<string, unknown>) => {
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

  const merged = [...(assigned ?? []), ...selfWrapped]
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
      campaign_deliverables(id, title, type, status, due_date, platform, content_url)
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
