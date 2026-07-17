import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, influencerInviteEmail } from '@/lib/resend'
import { resolveBrandPlan, getPlanLimits, hasBrandPlanAccess, rosterLimitMessage, PLAN_ERROR_CODES } from '@/lib/plan-limits'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// POST /api/brand-campaigns/[id]/invite
// La marca invita a un influencer a una campaña (private u open).
// Crea campaign_influencers con origin='invitation', application_status='pending'.
// Los deliverables se crean automáticamente cuando el influencer acepta (PATCH applications).
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Verificar que la campaña pertenece a esta marca (owner o miembro activo)
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: brand } = await admin
    .from('brands')
    .select('id, name, organization_id')
    .eq('id', access.brandId)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, status, brand_id, organization_id')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (campaign.status === 'completed' || campaign.status === 'canceled') {
    return NextResponse.json({ error: 'No se puede invitar a una campaña finalizada' }, { status: 422 })
  }

  let body: {
    influencer_id: string
    proposed_fee?: number
    message?: string
    deliverables_spec?: Array<{
      type: string
      quantity: number
      platform?: string
      due_date?: string
    }>
  }

  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { influencer_id, proposed_fee, message, deliverables_spec } = body

  if (!influencer_id) return NextResponse.json({ error: 'influencer_id requerido' }, { status: 422 })

  // ── Roster limit gating ───────────────────────────────────────────────────
  // Resolver plan efectivo: override individual de la marca (brand.id) →
  // subscriptions activa/trialing → fallback organizations.subscription_plan.
  // IMPORTANTE: pasar brand.id para respetar subscription_plan_override.
  const orgPlan = await resolveBrandPlan(admin, brand.organization_id, brand.id)
  if (!hasBrandPlanAccess(orgPlan)) {
    return NextResponse.json(
      { error: 'Debes elegir y activar un plan para invitar creadoras.', code: 'PLAN_REQUIRED' },
      { status: 402 },
    )
  }
  const limits  = getPlanLimits(orgPlan)

  // IDs de todas las campañas de esta marca
  const { data: brandCampaigns } = await admin
    .from('campaigns')
    .select('id')
    .eq('brand_id', brand.id)

  const campaignIds = (brandCampaigns ?? []).map(c => c.id)

  if (campaignIds.length > 0) {
    // Influencers únicos en el roster (excluir rechazados)
    const { data: rosterRows } = await admin
      .from('campaign_influencers')
      .select('influencer_id')
      .in('campaign_id', campaignIds)
      .not('application_status', 'eq', 'rejected')

    const uniqueInRoster = new Set((rosterRows ?? []).map(r => r.influencer_id))

    // Si el influencer ya está en el roster no consume cupo
    if (!uniqueInRoster.has(influencer_id) && uniqueInRoster.size >= limits.max_roster_influencers) {
      return NextResponse.json({
        error: rosterLimitMessage(orgPlan),
        code:  PLAN_ERROR_CODES.ROSTER_LIMIT,
        plan:  orgPlan,
      }, { status: 403 })
    }
  }

  // Autorización por RELACIÓN (no por organization_id — modelo de org única).
  // Se mantiene is_active. El acceso se decide igual que lista/detalle:
  //   - Pro (base completa): puede invitar a cualquier influencer activa.
  //   - Basic/Growth: solo su roster (brand_influencers) o influencers ya
  //     relacionadas a alguna de sus campañas.
  const { data: influencer } = await admin
    .from('influencers')
    .select('id, display_name, email, is_active')
    .eq('id', influencer_id)
    .single()

  if (!influencer || !influencer.is_active) {
    return NextResponse.json({ error: 'Influencer no encontrado o inactivo' }, { status: 404 })
  }

  if (!limits.can_view_full_influencer_base) {
    const [{ data: rosterRow }, { data: relatedRow }] = await Promise.all([
      admin.from('brand_influencers').select('influencer_id')
        .eq('brand_id', brand.id).eq('influencer_id', influencer_id).maybeSingle(),
      campaignIds.length > 0
        ? admin.from('campaign_influencers').select('id')
            .in('campaign_id', campaignIds).eq('influencer_id', influencer_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!rosterRow && !relatedRow) {
      return NextResponse.json({
        error: 'Tu plan solo permite invitar influencers de tu roster. Sube a Pro para invitar desde el catálogo completo.',
        code:  PLAN_ERROR_CODES.INFLUENCER_BASE,
        plan:  orgPlan,
      }, { status: 403 })
    }
  }

  // Verificar que no haya invitación previa
  const { data: existing } = await admin
    .from('campaign_influencers')
    .select('id, application_status')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id)
    .single()

  if (existing) {
    return NextResponse.json({
      error: existing.application_status === 'pending'
        ? 'Ya existe una invitación pendiente para este influencer'
        : 'Este influencer ya tiene una relación activa con la campaña',
    }, { status: 422 })
  }

  // Crear invitación con nuevo schema
  const { data, error } = await admin
    .from('campaign_influencers')
    .insert({
      campaign_id:        params.id,
      influencer_id,
      application_status: 'pending',
      origin:             'invitation',
      fee:                proposed_fee ?? null,
      message:            message ?? null,
      deliverables_spec:  deliverables_spec ? JSON.stringify(deliverables_spec) : '[]',
    })
    .select('id, application_status, origin, fee')
    .single()

  if (error) {
    console.error('[POST /api/brand-campaigns/[id]/invite]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Notificar al influencer por email (gap G-08, cerrado 2026-07-01) ─────────
  // No bloqueante: si el influencer no tiene email o el envío falla, la invitación
  // ya quedó creada — solo se pierde la notificación, no el flujo funcional.
  //
  // PREASIGNACIÓN EN DRAFT: si la campaña aún es borrador, la invitación queda
  // creada pero SILENCIOSA (sin email). El aviso se envía una sola vez al
  // activar la campaña (ver notifyPreassignedInfluencersOnActivation).
  if (campaign.status !== 'draft' && influencer.email) {
    try {
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: influencer.email,
        subject: `${brand.name} te invitó a una campaña en Scence`,
        html: influencerInviteEmail({
          influencerName: influencer.display_name,
          campaignName:   campaign.name,
          brandName:      brand.name,
          inviteUrl:      `${APP_URL}/inf-campaigns`,
          message:        message,
        }),
      })
      // Resend no lanza excepción en errores de API — hay que revisar `error`.
      if (emailErr) console.error('[invite email] Resend devolvió error:', emailErr)
    } catch (e) {
      console.error('[invite email] non-fatal:', e)
    }
  }

  return NextResponse.json({ data }, { status: 201 })
}
