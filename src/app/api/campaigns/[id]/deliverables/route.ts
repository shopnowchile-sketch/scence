import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { DELIVERABLE_DESCRIPTION_MAX, expandDeliverableTemplates } from '@/lib/deliverable-templates'
import { deliverableStatusEmail, FROM_EMAIL, getResend } from '@/lib/resend'

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
    scheduled_at,
  } = body

  if (!influencer_id || !title || !type) {
    return NextResponse.json(
      { error: 'influencer_id, title and type are required' },
      { status: 422 }
    )
  }

  if (typeof description === 'string' && description.length > DELIVERABLE_DESCRIPTION_MAX) {
    return NextResponse.json({ error: `La descripción no puede superar ${DELIVERABLE_DESCRIPTION_MAX} caracteres` }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data: assignment } = await admin
    .from('campaign_influencers')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id as string)
    .maybeSingle()

  const rows = expandDeliverableTemplates([{
    type: type as string,
    title: title as string,
    description: description as string | undefined,
    due_date: due_date as string | undefined,
    scheduled_at: scheduled_at as string | undefined,
    platform: platform as string | undefined,
    quantity: Number(quantity) || 1,
  }]).map(template => ({
    campaign_id: params.id,
    influencer_id,
    campaign_influencer_id: assignment?.id ?? null,
    ...template,
    status: 'pending',
  }))

  const { data, error } = await admin
    .from('campaign_deliverables')
    .insert(rows)
    .select(`*, influencer:influencers (id, display_name, avatar_url)`)

  if (error) {
    console.error('[POST /api/campaigns/[id]/deliverables]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  const { deliverable_id, action, review_notes, submitted_url, progress, rating } = body as {
    deliverable_id: string
    action: 'approve' | 'reject' | 'submit' | 'publish' | 'update_progress' | 'rate'
    review_notes?: string
    submitted_url?: string
    progress?: number
    rating?: number
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
    case 'rate':
      if (rating === undefined || ![1, 2, 3, 4, 5].includes(rating)) {
        return NextResponse.json({ error: 'rating debe ser un número entre 1 y 5' }, { status: 422 })
      }
      updatePayload.content_rating = rating
      break
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 422 })
  }

  const admin = createAdminClient()

  // Verify deliverable belongs to this campaign
  const { data: existing, error: fetchErr } = await admin
    .from('campaign_deliverables')
    .select(`
      id, campaign_id, influencer_id, type, title, due_date,
      campaign:campaigns (id, name),
      influencer:influencers (display_name, email)
    `)
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

  // Recalcular influencers.rating tras calificar un entregable — promedio de
  // content_rating de TODOS sus deliverables (cualquier campaña), redondeado
  // a 1 decimal. Non-fatal: si falla, no debe tumbar la respuesta del rate.
  if (action === 'rate' && existing.influencer_id) {
    try {
      const { data: ratedDeliverables, error: ratingsErr } = await admin
        .from('campaign_deliverables')
        .select('content_rating')
        .eq('influencer_id', existing.influencer_id)
        .not('content_rating', 'is', null)

      if (ratingsErr) {
        console.error('[PATCH deliverables] error leyendo ratings para promedio:', ratingsErr)
      } else {
        const ratings = (ratedDeliverables ?? []).map(d => d.content_rating as number)
        const avgRating = ratings.length > 0
          ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
          : null

        const { error: updateRatingErr } = await admin
          .from('influencers')
          .update({ rating: avgRating })
          .eq('id', existing.influencer_id)

        if (updateRatingErr) {
          console.error('[PATCH deliverables] error actualizando influencers.rating:', updateRatingErr)
        }
      }
    } catch (e) {
      console.error('[PATCH deliverables] recalculo de rating falló (non-fatal):', e)
    }
  }

  // Al rechazar, la influencer debe saber qué corregir y poder reenviar el
  // link de inmediato. El email es no fatal: el estado rechazado se conserva
  // aunque Resend tenga una interrupción temporal.
  if (action === 'reject') {
    const influencer = existing.influencer as unknown as { display_name: string | null; email: string | null } | null
    const campaign = existing.campaign as unknown as { id: string; name: string | null } | null
    if (influencer?.email) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
        const deliverableUrl = `${appUrl}/inf-deliverables?campaign=${encodeURIComponent(params.id)}`
        const { error: emailError } = await getResend().emails.send({
          from: FROM_EMAIL,
          to: influencer.email,
          subject: `❌ Tu contenido necesita ajustes — ${campaign?.name ?? 'SCENCE'}`,
          html: deliverableStatusEmail({
            influencerName: influencer.display_name ?? 'hola',
            deliverableTitle: existing.title,
            campaignName: campaign?.name ?? 'Campaña SCENCE',
            status: 'rejected',
            reviewNotes: review_notes,
            deliverableUrl,
          }),
        })
        if (emailError) console.error('[deliverable rejection email]', emailError)
      } catch (emailError) {
        console.error('[deliverable rejection email]', emailError)
      }
    }
  }

  return NextResponse.json({ data })
}
