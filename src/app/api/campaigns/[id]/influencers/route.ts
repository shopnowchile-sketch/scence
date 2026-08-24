import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { attendanceClosedEmail, attendanceConfirmationEmail, getResend, FROM_EMAIL, campaignAssignedEmail, influencerInviteEmail } from '@/lib/resend'
import { expandDeliverableTemplates, type DeliverableTemplateInput } from '@/lib/deliverable-templates'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { buildManualAttendanceUpdate, type ManualAttendanceAction } from '@/lib/manual-attendance'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

type Params = { params: { id: string } }

// ── GET /api/campaigns/[id]/influencers ───────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await authorizeCampaignBrandAction(user.id, params.id, 'influencer.read'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  if (!(await authorizeCampaignBrandAction(user.id, params.id, 'influencer.manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
      // Cuando la campaña tiene asistencia pendiente, el alta manual ya es una
      // aceptación. El único paso que queda para la influencer es confirmar
      // desde su perfil; por eso se envía ese email específico, no una invitación.
      const { data: attendance } = await admin
        .from('campaign_deliverables')
        .select('due_date')
        .eq('campaign_id', params.id)
        .eq('influencer_id', influencer_id as string)
        .eq('type', 'event_attendance')
        .eq('status', 'pending')
        .is('attendance_response', null)
        .maybeSingle()
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: inf.email,
        subject: attendance ? `Confirma tu asistencia: ${camp.name}` : invite ? `Tienes una invitación privada: ${camp.name}` : `Fuiste asignada a la campaña "${camp.name}"`,
        html: attendance
          ? attendanceConfirmationEmail({ influencerName: inf.display_name ?? 'Influencer', campaignName: camp.name, campaignId: params.id, dueDate: attendance.due_date })
          : invite
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
  if (!(await authorizeCampaignBrandAction(user.id, params.id, 'influencer.manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const influencerId = searchParams.get('influencer_id')

  if (!influencerId) {
    return NextResponse.json({ error: 'influencer_id query param required' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Los entregables pendientes sin URL pueden eliminarse junto con la
  // asignación. Cualquier URL enviada es evidencia de contenido y protege a la
  // influencer de una eliminación accidental.
  const { data: relation } = await admin
    .from('campaign_influencers')
    .select('id, application_status, metadata, influencer:influencers(display_name, email)')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencerId)
    .maybeSingle()

  if (relation) {
    const { data: deliverables, error: deliverablesError } = await admin
      .from('campaign_deliverables')
      .select('id, type, content_url, published_url, attendance_response, attendance_outcome')
      .eq('campaign_influencer_id', relation.id)

    if (deliverablesError) {
      return NextResponse.json({ error: deliverablesError.message }, { status: 500 })
    }

    const hasSubmittedContent = (deliverables ?? []).some(deliverable =>
      Boolean(deliverable.content_url?.trim() || deliverable.published_url?.trim())
    )

    // Una aceptada que todavía no respondió la confirmación sí puede perder el
    // cupo aunque exista una URL histórica. No borramos la relación ni sus
    // entregables: sale de "Aceptadas" al quedar rejected y la influencer puede
    // ver el motivo en su historial. La URL se conserva como evidencia.
    const hasUnconfirmedAttendance = (deliverables ?? []).some(deliverable =>
      deliverable.type === 'event_attendance'
      && !deliverable.attendance_response
      && deliverable.attendance_outcome !== 'no_show'
    )
    const hasConfirmedAttendance = (deliverables ?? []).some(deliverable =>
      deliverable.type === 'event_attendance'
      && deliverable.attendance_response === 'confirmed'
    )

    if (relation.application_status === 'accepted' && hasUnconfirmedAttendance) {
      const removedAt = new Date().toISOString()
      const metadata = {
        ...((relation.metadata as Record<string, unknown> | null) ?? {}),
        removal_reason: 'attendance_deadline_closed',
        removal_message: 'Lo sentimos, no confirmaste tu asistencia antes de la fecha límite y los cupos se cerraron.',
        removed_at: removedAt,
      }
      const { error: rejectError } = await admin
        .from('campaign_influencers')
        .update({
          application_status: 'rejected',
          status: 'canceled',
          metadata,
          updated_at: removedAt,
        })
        .eq('id', relation.id)

      if (rejectError) {
        console.error('[DELETE /api/campaigns/[id]/influencers] close unconfirmed slot', rejectError)
        return NextResponse.json({ error: rejectError.message }, { status: 500 })
      }

      try {
        const influencer = relation.influencer as { display_name?: string | null; email?: string | null } | null
        if (influencer?.email) {
          const { data: campaign } = await admin.from('campaigns').select('name').eq('id', params.id).single()
          const { error: emailError } = await getResend().emails.send({
            from: FROM_EMAIL,
            to: influencer.email,
            subject: `Cupos cerrados: ${campaign?.name ?? 'campaña'}`,
            html: attendanceClosedEmail({ influencerName: influencer.display_name ?? 'Influencer' }),
          })
          if (emailError) console.error('[DELETE /api/campaigns/[id]/influencers] attendance deadline email', emailError)
        }
      } catch (emailError) {
        console.error('[DELETE /api/campaigns/[id]/influencers] attendance deadline email', emailError)
      }

      return NextResponse.json({
        success: true,
        outcome: 'attendance_deadline_closed',
        content_preserved: hasSubmittedContent,
      })
    }

    if (relation.application_status === 'accepted' && hasConfirmedAttendance) {
      return NextResponse.json({
        error: 'No se puede quitar una influencer que ya confirmó su asistencia.',
        code: 'CAMPAIGN_INFLUENCER_ATTENDANCE_CONFIRMED',
      }, { status: 409 })
    }

    if (hasSubmittedContent) {
      return NextResponse.json({
        error: 'No se puede quitar esta influencer porque ya envió contenido. Su URL se conserva en la campaña.',
        code: 'CAMPAIGN_INFLUENCER_HAS_SUBMITTED_CONTENT',
      }, { status: 409 })
    }

    const pendingIds = (deliverables ?? []).map(deliverable => deliverable.id)
    if (pendingIds.length > 0) {
      const { error: deleteDeliverablesError } = await admin
        .from('campaign_deliverables')
        .delete()
        .in('id', pendingIds)

      if (deleteDeliverablesError) {
        return NextResponse.json({ error: deleteDeliverablesError.message }, { status: 500 })
      }
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
  if (!(await authorizeCampaignBrandAction(user.id, params.id, 'influencer.manage'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { influencer_id, attendance_action, ...updates } = body

  if (!influencer_id) {
    return NextResponse.json({ error: 'influencer_id is required' }, { status: 422 })
  }

  const admin = createAdminClient()

  if (attendance_action !== undefined) {
    if (!['confirmed_client', 'attended', 'no_show'].includes(String(attendance_action))) {
      return NextResponse.json({ error: 'Acción de asistencia inválida.' }, { status: 422 })
    }

    const { data: relation, error: relationError } = await admin.from('campaign_influencers')
      .select('id, application_status, status, metadata')
      .eq('campaign_id', params.id)
      .eq('influencer_id', influencer_id as string)
      .maybeSingle()
    if (relationError) return NextResponse.json({ error: relationError.message }, { status: 500 })
    const metadata = (relation?.metadata as Record<string, unknown> | null) ?? {}
    const isDeadlineClosure = metadata.removal_reason === 'attendance_deadline_closed'
    if (!relation || (relation.application_status !== 'accepted' && !isDeadlineClosure)) {
      return NextResponse.json({ error: 'La influencer no pertenece a esta campaña como participante aceptada.' }, { status: 422 })
    }

    const { data: attendance, error: attendanceError } = await admin.from('campaign_deliverables')
      .select('id, attendance_response, attendance_note')
      .eq('campaign_id', params.id)
      .eq('influencer_id', influencer_id as string)
      .eq('type', 'event_attendance')
      .limit(1)
      .maybeSingle()
    if (attendanceError) return NextResponse.json({ error: attendanceError.message }, { status: 500 })
    if (!attendance) return NextResponse.json({ error: 'Esta influencer no tiene confirmación de asistencia en la campaña.' }, { status: 422 })

    const now = new Date().toISOString()
    const attendanceUpdate = buildManualAttendanceUpdate({
      action: attendance_action as ManualAttendanceAction,
      currentResponse: attendance.attendance_response,
      currentNote: attendance.attendance_note,
      now,
    })
    let reinstated = false
    if (attendance_action === 'attended' && isDeadlineClosure) {
      const { removal_reason: _removalReason, removal_message: _removalMessage, ...preservedMetadata } = metadata
      const { error: reinstateError } = await admin.from('campaign_influencers').update({
        application_status: 'accepted',
        status: 'active',
        metadata: { ...preservedMetadata, attendance_reinstated_at: now, attendance_reinstated_by: user.id },
        updated_at: now,
      }).eq('id', relation.id)
      if (reinstateError) return NextResponse.json({ error: reinstateError.message }, { status: 500 })
      reinstated = true
    }

    const { error: updateAttendanceError } = await admin.from('campaign_deliverables')
      .update(attendanceUpdate)
      .eq('id', attendance.id)
    if (updateAttendanceError) {
      if (reinstated) {
        await admin.from('campaign_influencers').update({
          application_status: relation.application_status,
          status: relation.status,
          metadata,
          updated_at: now,
        }).eq('id', relation.id)
      }
      return NextResponse.json({ error: updateAttendanceError.message }, { status: 500 })
    }

    return NextResponse.json({ data: { influencer_id, attendance_action } })
  }

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
