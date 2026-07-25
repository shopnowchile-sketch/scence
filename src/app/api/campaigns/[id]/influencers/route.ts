import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, campaignAssignedEmail, influencerInviteEmail } from '@/lib/resend'
import { expandDeliverableTemplates, type DeliverableTemplateInput } from '@/lib/deliverable-templates'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

type Params = { params: { id: string } }

// ── GET /api/campaigns/[id]/influencers ───────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      *,
      influencer:influencers (
        id, display_name, avatar_url, city, country, is_verified,
        influencer_social_profiles (platform, username, followers, engagement_rate),
        influencer_rate_cards (deliverable_type, base_rate, currency)
      )
    `)
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[GET /api/campaigns/[id]/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── POST /api/campaigns/[id]/influencers — add influencer to campaign ──────────
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

  const { influencer_id, fee, notes } = body
  const invite = body.invite === true

  if (!influencer_id) {
    return NextResponse.json({ error: 'influencer_id is required' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Detectar si ya existía (para no reenviar el email de asignación en un re-add)
  const { data: existingCi } = await admin
    .from('campaign_influencers')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id as string)
    .maybeSingle()
  const isNewAssignment = !existingCi

  if (invite && existingCi) {
    return NextResponse.json({ error: 'Esta influencer ya tiene una invitación o participación en la campaña' }, { status: 422 })
  }

  // Upsert to handle duplicate adds gracefully.
  // Alta DIRECTA del admin = participación inmediata (no es una solicitud): se
  // marca aceptada/activa explícitamente, sin depender de los defaults de la
  // tabla (que dejarían application_status='pending' y la excluirían de
  // participantes + del acceso al detalle privado). origin se mantiene en
  // 'invitation' (único valor compatible con el CHECK actual junto a
  // 'application') — no se crea un origen nuevo ni migración.
  const { data, error } = await admin
    .from('campaign_influencers')
    .upsert(
      {
        campaign_id: params.id,
        influencer_id,
        fee: fee ?? null,
        notes: notes ?? null,
        status: invite ? 'pending' : 'active',
        application_status: invite ? 'pending' : 'accepted',
        origin: invite ? 'invitation' : 'invitation',
        ...(invite ? {} : { accepted_at: new Date().toISOString() }),
      },
      { onConflict: 'campaign_id,influencer_id' }
    )
    .select(`
      *,
      influencer:influencers (
        id, display_name, avatar_url, city, country, email,
        influencer_social_profiles (platform, username, followers, engagement_rate)
      )
    `)
    .single()

  if (error) {
    console.error('[POST /api/campaigns/[id]/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Auto-create campaign_deliverables from campaign's deliverable_templates ──
  if (!invite) try {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('organization_id, start_date, deliverable_templates, name, type')
      .eq('id', params.id)
      .single()

    if (campaign) {
      // Auto-deliverables from templates
      const templates = Array.isArray(campaign.deliverable_templates)
        ? (campaign.deliverable_templates as Array<{
            type: string; quantity: number; description?: string; due_date?: string
          }>)
        : []

      if (templates.length > 0) {
        // Check if deliverables already exist for this influencer (avoid dups on re-add)
        const { data: existing } = await admin
          .from('campaign_deliverables')
          .select('id')
          .eq('campaign_id', params.id)
          .eq('influencer_id', influencer_id as string)

        if (!existing?.length) {
          const deliverablesToInsert = expandDeliverableTemplates(templates as DeliverableTemplateInput[]).map(t => ({
            campaign_id:           params.id,
            influencer_id:         influencer_id as string,
            campaign_influencer_id: data.id,
            ...t,
            status:                'pending',
          }))

          const { error: insertDelErr } = await admin
            .from('campaign_deliverables')
            .insert(deliverablesToInsert)

          if (insertDelErr) {
            console.error('[auto-deliverables] failed:', insertDelErr.message)
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal
    console.error('[auto-deliverables] failed:', e)
  }

  // ── Notificar por email a la influencer de la asignación directa (no bloqueante) ──
  // Antes este flujo (a diferencia de aprobar una postulación, ver campaign-applications.ts)
  // no enviaba ningún email — la influencer solo se enteraba si entraba a mirar el dashboard.
  try {
    const inf = (data as { influencer?: { display_name?: string | null; email?: string | null } | null }).influencer
    const { data: camp } = await admin
      .from('campaigns')
      .select('name, type, status, brand:brands!brand_id(name)')
      .eq('id', params.id)
      .single()

    // Preasignación en draft: no enviar email todavía; se avisa al activar.
    if (isNewAssignment && inf?.email && camp?.name && camp.status !== 'draft') {
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: inf.email,
        subject: invite ? `Tienes una invitación privada: ${camp.name}` : `Fuiste asignada a la campaña "${camp.name}"`,
        html: invite
          ? influencerInviteEmail({ influencerName: inf.display_name ?? 'Influencer', campaignName: camp.name, brandName: (camp.brand as { name?: string } | null)?.name ?? 'Scence', inviteUrl: `${APP_URL}/inf-campaigns` })
          : campaignAssignedEmail({ influencerName: inf.display_name ?? 'Influencer', campaignName: camp.name, campaignType: camp.type, campaignUrl: `${APP_URL}/inf-campaign/${params.id}` }),
      })
      // Resend no lanza excepción en errores de API — hay que revisar `error`.
      if (emailErr) console.error('[POST /api/campaigns/[id]/influencers] Resend devolvió error:', emailErr)
    }
  } catch (emailErr) {
    console.error('[POST /api/campaigns/[id]/influencers] email notification failed (non-fatal):', emailErr)
  }

  return NextResponse.json({ data }, { status: 201 })
}

// ── DELETE /api/campaigns/[id]/influencers — remove influencer from campaign ───
export async function DELETE(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const influencerId = searchParams.get('influencer_id')

  if (!influencerId) {
    return NextResponse.json({ error: 'influencer_id query param required' }, { status: 422 })
  }

  const admin = createAdminClient()

  // No borrar una relación si ya tiene entregables: campaign_deliverables
  // referencia campaign_influencers con ON DELETE CASCADE, por lo que una
  // eliminación directa borraría también contenido entregado. Esto cubre
  // invitaciones antiguas que aún aparecen como "pending" aunque la creadora
  // sí haya trabajado en la campaña.
  const { data: relation } = await admin
    .from('campaign_influencers')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencerId)
    .maybeSingle()

  if (relation) {
    const { count, error: deliverablesError } = await admin
      .from('campaign_deliverables')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_influencer_id', relation.id)

    if (deliverablesError) {
      return NextResponse.json({ error: deliverablesError.message }, { status: 500 })
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: 'No se puede quitar esta influencer porque tiene entregables asociados. Su contenido se conserva en la campaña.',
        code: 'CAMPAIGN_INFLUENCER_HAS_DELIVERABLES',
      }, { status: 409 })
    }
  }

  const { error } = await admin
    .from('campaign_influencers')
    .delete()
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencerId)

  if (error) {
    console.error('[DELETE /api/campaigns/[id]/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// ── PATCH /api/campaigns/[id]/influencers — update status/fee ─────────────────
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

  const { influencer_id, ...updates } = body

  if (!influencer_id) {
    return NextResponse.json({ error: 'influencer_id is required' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('campaign_influencers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id as string)
    .select()
    .single()

  if (error) {
    console.error('[PATCH /api/campaigns/[id]/influencers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Auto-assign deliverables when approving an application ──────────────────
  // If transitioning from 'applied' to 'active', copy campaign's deliverable_templates
  if (updates.status === 'active') {
    try {
      // Check if influencer already has deliverables in this campaign
      const { data: existingDelivs } = await admin
        .from('campaign_deliverables')
        .select('id')
        .eq('campaign_id', params.id)
        .eq('influencer_id', influencer_id as string)
        .limit(1)

      if (!existingDelivs?.length) {
        // Get campaign deliverable_templates
        const { data: camp } = await admin
          .from('campaigns')
          .select('deliverable_templates, organization_id')
          .eq('id', params.id)
          .single()

        const templates = (camp?.deliverable_templates as Array<Record<string, unknown>>) ?? []

        if (templates.length > 0) {
          await admin.from('campaign_deliverables').insert(
            expandDeliverableTemplates(templates as DeliverableTemplateInput[]).map(t => ({
              campaign_id: params.id,
              influencer_id: influencer_id as string,
              organization_id: camp!.organization_id,
              ...t,
              status: 'pending',
              progress: 0,
            }))
          )
        }
      }
    } catch (e) {
      console.error('[PATCH influencers] auto-assign deliverables failed:', e)
      // Non-fatal — don't fail the PATCH
    }
  }

  return NextResponse.json({ data })
}
