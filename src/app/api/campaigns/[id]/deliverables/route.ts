import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { syncDeliverableTask } from '@/lib/influencer-tasks'

type Params = { params: { id: string } }

// ── GET /api/campaigns/[id]/deliverables ──────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('campaign_deliverables')
    .select(`
      *,
      influencer:influencers (id, display_name, avatar_url)
    `)
    .eq('campaign_id', params.id)
    .order('due_date', { ascending: true })

  if (error) {
    console.error('[GET /api/campaigns/[id]/deliverables]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── POST /api/campaigns/[id]/deliverables — create ────────────────────────────
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    influencer_id,
    title,
    type,
    platform,
    due_date,
    description,
    quantity,
  } = body

  if (!influencer_id || !title || !type) {
    return NextResponse.json(
      { error: 'influencer_id, title and type are required' },
      { status: 422 }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('campaign_deliverables')
    .insert({
      campaign_id: params.id,
      influencer_id,
      title,
      type,
      platform: platform ?? null,
      due_date: due_date ?? null,
      description: description ?? null,
      quantity: quantity ? Number(quantity) : 1,
      status: 'pending',
    })
    .select(`*, influencer:influencers (id, display_name, avatar_url)`)
    .single()

  if (error) {
    console.error('[POST /api/campaigns/[id]/deliverables]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-sync: crear influencer_task vinculada a este deliverable
  if (data && influencer_id) {
    const { data: camp } = await admin
      .from('campaigns')
      .select('organization_id')
      .eq('id', params.id)
      .single()

    if (camp) {
      await syncDeliverableTask(admin, {
        organizationId:    camp.organization_id,
        influencerId:      influencer_id as string,
        deliverableId:     data.id,
        campaignId:        params.id,
        deliverableType:   data.type,
        deliverableTitle:  data.title,
        deliverableStatus: 'pending',
        dueDate:           data.due_date ?? null,
      })
    }
  }

  return NextResponse.json({ data }, { status: 201 })
}

// ── PATCH /api/campaigns/[id]/deliverables — approve / reject / submit ─────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { deliverable_id, action, review_notes, submitted_url, progress } = body as {
    deliverable_id: string
    action: 'approve' | 'reject' | 'submit' | 'publish' | 'update_progress'
    review_notes?: string
    submitted_url?: string
    progress?: number
  }

  if (!deliverable_id || !action) {
    return NextResponse.json(
      { error: 'deliverable_id and action are required' },
      { status: 422 }
    )
  }

  const now = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    updated_at: now,
    ...(review_notes !== undefined && { review_notes }),
  }

  switch (action) {
    case 'approve':
      updatePayload.status      = 'approved'
      updatePayload.reviewed_at = now     // DB column: reviewed_at
      updatePayload.reviewed_by = user.id // DB column: reviewed_by
      break
    case 'reject':
      updatePayload.status      = 'rejected'
      updatePayload.reviewed_at = now
      updatePayload.reviewed_by = user.id
      break
    case 'submit':
      updatePayload.status = 'in_review'
      // submitted_url/submitted_at don't exist — store URL in published_url if provided
      if (submitted_url) updatePayload.published_url = submitted_url
      break
    case 'publish':
      updatePayload.status       = 'published'
      updatePayload.published_at = now
      break
    case 'update_progress':
      if (progress === undefined || ![0, 25, 50, 75, 100].includes(progress)) {
        return NextResponse.json({ error: 'progress must be 0, 25, 50, 75, or 100' }, { status: 422 })
      }
      updatePayload.progress = progress
      // Auto-advance status based on progress
      if (progress === 0)   updatePayload.status = 'pending'
      if (progress === 100) updatePayload.status = 'in_review'
      break
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 422 })
  }

  const admin = createAdminClient()

  // Verify deliverable belongs to this campaign
  const { data: existing, error: fetchErr } = await admin
    .from('campaign_deliverables')
    .select('id, campaign_id, influencer_id, type, title, due_date')
    .eq('id', deliverable_id)
    .eq('campaign_id', params.id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Deliverable not found in this campaign' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('campaign_deliverables')
    .update(updatePayload)
    .eq('id', deliverable_id)
    .select(`*, influencer:influencers (id, display_name, avatar_url)`)
    .single()

  if (error) {
    console.error('[PATCH /api/campaigns/[id]/deliverables]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sincronizar el status de la influencer_task vinculada (non-fatal)
  if (data && existing.influencer_id && updatePayload.status) {
    const { data: camp } = await admin
      .from('campaigns')
      .select('organization_id')
      .eq('id', params.id)
      .single()

    if (camp) {
      await syncDeliverableTask(admin, {
        organizationId:    camp.organization_id,
        influencerId:      existing.influencer_id,
        deliverableId:     deliverable_id,
        campaignId:        params.id,
        deliverableType:   existing.type,
        deliverableTitle:  existing.title,
        deliverableStatus: updatePayload.status as string,
        dueDate:           existing.due_date ?? null,
      })
    }
  }

  return NextResponse.json({ data })
}
