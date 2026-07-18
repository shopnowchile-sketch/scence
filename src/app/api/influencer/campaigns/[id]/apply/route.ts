import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { acceptCampaignApplication } from '@/lib/campaign-applications'

type Params = { params: { id: string } }

// POST /api/influencer/campaigns/[id]/apply
// Influencer postula a una campaña open — crea campaign_influencers con application_status='pending', origin='application'
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, organization_id, display_name')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Verificar que la campaña existe, es open y está activa o en pending_approval
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, status, visibility, organization_id, application_deadline, applications_closed_at, max_influencers, brand_id, application_questions')
    .eq('id', params.id)
    .eq('organization_id', influencer.organization_id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (campaign.visibility !== 'open') return NextResponse.json({ error: 'Esta campaña no está abierta a postulaciones' }, { status: 422 })
  if (!['active', 'pending_approval', 'draft'].includes(campaign.status)) {
    return NextResponse.json({ error: 'Esta campaña no acepta postulaciones en este momento' }, { status: 422 })
  }
  if (campaign.application_deadline && new Date(campaign.application_deadline) < new Date()) {
    return NextResponse.json({ error: 'El plazo de postulación ha cerrado' }, { status: 422 })
  }
  if (campaign.applications_closed_at) {
    return NextResponse.json({ error: 'La marca cerró las postulaciones de esta campaña' }, { status: 422 })
  }

  // Los cupos representan participantes aceptadas, no la cantidad de personas
  // que puede manifestar interés. Al agotarse, no se reciben postulaciones nuevas.
  if (campaign.max_influencers && campaign.max_influencers > 0) {
    const { count: acceptedCount, error: countError } = await admin
      .from('campaign_influencers')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', params.id)
      .eq('application_status', 'accepted')

    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })
    if ((acceptedCount ?? 0) >= campaign.max_influencers) {
      return NextResponse.json({ error: 'Los cupos de esta campaña están agotados' }, { status: 422 })
    }
  }

  // Verificar que no haya postulación previa
  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .single()

  if (existing) {
    return NextResponse.json({
      error: existing.application_status === 'pending'
        ? 'Ya enviaste una postulación a esta campaña'
        : 'Ya tienes una relación activa con esta campaña',
    }, { status: 422 })
  }

  // Leer mensaje opcional + respuestas a las preguntas de postulación del body
  let message: string | null = null
  let answers: string[] = []
  try {
    const body = await req.json()
    message = body?.message ?? null
    answers = Array.isArray(body?.answers) ? body.answers.map((a: unknown) => String(a ?? '').trim()) : []
  } catch { /* body vacío es ok */ }

  // Preguntas de postulación (opcional, la define la marca al crear la
  // campaña). Si la campaña tiene preguntas, responderlas es obligatorio —
  // pedido de Pri 2026-07-12: "solo si hay preguntas desde la marca, la
  // influencer debe responder obligatorio con su postulación".
  const questions = Array.isArray(campaign.application_questions) ? campaign.application_questions as string[] : []
  if (questions.length > 0) {
    const missing = questions.length !== answers.length || answers.some(a => !a)
    if (missing) {
      return NextResponse.json({
        error: 'Esta campaña tiene preguntas obligatorias — responde todas para postular.',
      }, { status: 422 })
    }
  }

  // Crear postulación con nuevo schema
  const { data, error } = await admin
    .from('campaign_influencers')
    .insert({
      campaign_id:          params.id,
      influencer_id:        influencer.id,
      application_status:   'pending',
      origin:               'application',
      message:              message,
      fee:                  null,
      deliverables_spec:    '[]',
      application_answers:  questions.length > 0
        ? questions.map((q, i) => ({ question: q, answer: answers[i] }))
        : [],
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id })
}

// DELETE /api/influencer/campaigns/[id]/apply — cancel application
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers').select('id').eq('user_id', user.id).single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  await admin
    .from('campaign_influencers')
    .delete()
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .eq('application_status', 'pending')
    .eq('origin', 'application')

  return NextResponse.json({ ok: true })
}

// PATCH /api/influencer/campaigns/[id]/apply
// Influencer responde a una INVITACIÓN de marca (origin='invitation') a una
// campaña privada — accept crea deliverables + activa campaña (misma lógica
// compartida que usa el portal Marca al aprobar postulaciones, ver
// src/lib/campaign-applications.ts), reject solo marca application_status.
//
// Gap encontrado en UAT: la marca podía "aceptar" su propia invitación desde
// /brand-campaigns/[id]/applications, pero el influencer invitado nunca tenía
// forma de aceptar o rechazar — quedaba "En revisión" para siempre sin que
// nadie del lado correcto pudiera decidir. Este endpoint es la pieza que
// faltaba, scopeada estrictamente a la propia fila del influencer.
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  let body: { action?: 'accept' | 'reject'; answers?: unknown[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.action !== 'accept' && body.action !== 'reject') {
    return NextResponse.json({ error: "action debe ser 'accept' o 'reject'" }, { status: 422 })
  }

  const { data: row } = await admin
    .from('campaign_influencers')
    .select('id, application_status, origin')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 })
  if (row.origin !== 'invitation') {
    return NextResponse.json({ error: 'Esto no es una invitación de marca (usa DELETE para retirar una postulación propia)' }, { status: 422 })
  }
  if (row.application_status !== 'pending') {
    return NextResponse.json({ error: 'Esta invitación ya fue gestionada' }, { status: 422 })
  }

  if (body.action === 'accept') {
    // Preguntas de la campaña (opcional, mismo mecanismo que la postulación
    // pública) — si la campaña privada tiene preguntas, responderlas es
    // obligatorio antes de aceptar la invitación. Pedido de Pri 2026-07-12.
    const { data: campaign } = await admin
      .from('campaigns')
      .select('application_questions')
      .eq('id', params.id)
      .single()

    const questions = Array.isArray(campaign?.application_questions) ? campaign.application_questions as string[] : []
    const answers = Array.isArray(body.answers) ? body.answers.map(a => String(a ?? '').trim()) : []

    if (questions.length > 0) {
      const missing = questions.length !== answers.length || answers.some(a => !a)
      if (missing) {
        return NextResponse.json({
          error: 'Esta invitación tiene preguntas obligatorias — responde todas para aceptar.',
        }, { status: 422 })
      }

      const { error: answersError } = await admin
        .from('campaign_influencers')
        .update({
          application_answers: questions.map((q, i) => ({ question: q, answer: answers[i] })),
        })
        .eq('id', row.id)
      if (answersError) return NextResponse.json({ error: answersError.message }, { status: 500 })
    }

    const result = await acceptCampaignApplication(admin, {
      campaignId: params.id,
      applicationId: row.id,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, status: 'accepted' })
  }

  const { error: updateError } = await admin
    .from('campaign_influencers')
    .update({ application_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', row.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: 'rejected' })
}
