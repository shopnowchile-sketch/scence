import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { syncDeliverableTask } from '@/lib/influencer-tasks'
import { getResend, FROM_EMAIL, campaignAssignedEmail } from '@/lib/resend'

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

  // Upsert to handle duplicate adds gracefully
  const { data, error } = await admin
    .from('campaign_influencers')
    .upsert(
      {
        campaign_id: params.id,
        influencer_id,
        fee: fee ?? null,
        notes: notes ?? null,
        status: 'draft',  // valid campaign_status enum value
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
  try {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('organization_id, start_date, deliverable_templates, name, type')
      .eq('id', params.id)
      .single()

    if (campaign) {
      // NOTA (fix 2026-07-01): antes se llamaba createInfluencerTasks() acá,
      // que insertaba 4 tareas genéricas hardcodeadas ("Aprobar brief",
      // "Grabar contenido", "Entregar contenido", "Publicar en redes") sin
      // vincular a ningún deliverable real (deliverable_id null). Quedaban
      // mezcladas en "Tareas pendientes" del influencer junto a las tareas
      // reales sincronizadas 1:1 desde campaign_deliverables (syncDeliverableTask
      // más abajo), sin corresponder a nada que la marca haya pedido de verdad.
      // Se quita: las únicas influencer_tasks que debe generar este flujo son
      // las vinculadas a un deliverable real.

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
          const deliverablesToInsert = templates.map(t => ({
            campaign_id:           params.id,
            influencer_id:         influencer_id as string,
            campaign_influencer_id: data.id,
            type:                  t.type,
            title:                 t.description || t.type,
            description:           t.description ?? null,
            quantity:              t.quantity ?? 1,
            due_date:              t.due_date || null,
            status:                'pending',
          }))

          const { data: insertedDelivs, error: insertDelErr } = await admin
            .from('campaign_deliverables')
            .insert(deliverablesToInsert)
            .select('id, type, title, due_date')

          if (insertDelErr) {
            console.error('[auto-deliverables] failed:', insertDelErr.message)
          } else if (insertedDelivs?.length) {
            // Sincronizar cada deliverable con una influencer_task vinculada
            for (const del of insertedDelivs) {
              await syncDeliverableTask(admin, {
                organizationId:    campaign.organization_id,
                influencerId:      influencer_id as string,
                deliverableId:     del.id,
                campaignId:        params.id,
                deliverableType:   del.type,
                deliverableTitle:  del.title,
                deliverableStatus: 'pending',
                dueDate:           del.due_date ?? null,
              })
            }
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal
    console.error('[auto-tasks/deliverables] failed:', e)
  }

  // ── Notificar por email a la influencer de la asignación directa (no bloqueante) ──
  // Antes este flujo (a diferencia de aprobar una postulación, ver campaign-applications.ts)
  // no enviaba ningún email — la influencer solo se enteraba si entraba a mirar el dashboard.
  try {
    const inf = (data as { influencer?: { display_name?: string | null; email?: string | null } | null }).influencer
    const { data: camp } = await admin
      .from('campaigns')
      .select('name, type')
      .eq('id', params.id)
      .single()

    if (isNewAssignment && inf?.email && camp?.name) {
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: inf.email,
        subject: `Fuiste asignada a la campaña "${camp.name}"`,
        html: campaignAssignedEmail({
          influencerName: inf.display_name ?? 'Influencer',
          campaignName:   camp.name,
          campaignType:   camp.type,
          campaignUrl:    `${APP_URL}/inf-campaign/${params.id}`,
        }),
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
            templates.map(t => ({
              campaign_id: params.id,
              influencer_id: influencer_id as string,
              organization_id: camp!.organization_id,
              title: t.title ?? null,
              type: t.type ?? 'instagram_post',
              platform: t.platform ?? null,
              due_date: t.due_date ?? null,
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
