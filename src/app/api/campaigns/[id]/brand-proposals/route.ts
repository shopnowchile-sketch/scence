import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { buildCampaignContractContext } from '@/lib/contract-render'
import { normalizeCollaborationAccount, readOpportunity, toPlanSnapshot } from '@/lib/brand-plans'
import {
  applyIssue,
  applyWithdraw,
  effectiveAcceptanceDeadline,
  effectiveProposalStatus,
  readApplicationDetails,
  type ProposalEventSnapshot,
} from '@/lib/brand-proposal'
import { notifyBrandProposalIssued } from '@/lib/brand-proposal-notify'

type Params = { params: { id: string } }

// Propuestas comerciales de una campaña — SOLO Admin de plataforma.
// La propuesta vive en campaign_brand_applications.details.proposal.
// GET  → planes activos, datos de evento por defecto y propuestas por marca.
// POST → { action: 'preview' | 'issue' | 'withdraw' }.

async function authorize(campaignId: string) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const auth = await authorizeCampaignBrandAction(user.id, campaignId, 'campaign.manage')
  if (!auth || !auth.isPlatformAdmin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, auth }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const result = await authorize(params.id)
  if ('error' in result) return result.error
  const { admin } = result.auth

  const [{ data: campaign, error: campaignError }, { data: applications, error: appsError }] = await Promise.all([
    admin.from('campaigns').select('id, name, brand_id, metadata').eq('id', params.id).single(),
    admin.from('campaign_brand_applications')
      .select('id, brand_id, status, details, created_at, updated_at, brand:brands(id, name, instagram, contact_email)')
      .eq('campaign_id', params.id)
      .order('updated_at', { ascending: false }),
  ])
  if (campaignError || !campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  if (appsError) return NextResponse.json({ error: appsError.message }, { status: 500 })

  const view = readOpportunity(campaign.metadata)
  let eventDefaults: Record<string, string | undefined> = {}
  try {
    eventDefaults = (await buildCampaignContractContext(admin, { campaignId: params.id })).meta.eventDefaults
  } catch {
    eventDefaults = {}
  }
  const now = new Date()
  return NextResponse.json({
    data: {
      opportunity_enabled: Boolean(view?.enabled),
      mode: view?.mode ?? null,
      plans: view?.mode === 'plans' ? view.plans.filter(plan => plan.active).map(plan => ({ id: plan.id, name: plan.name, price: plan.price, currency: plan.currency, collaboration_included: plan.collaboration_included })) : [],
      event_defaults: eventDefaults,
      applications: (applications ?? []).map(row => {
        const details = readApplicationDetails(row.details)
        const proposal = details.proposal
        return {
          id: row.id,
          brand: row.brand,
          application_status: row.status,
          requested_plan_id: typeof details.requested_plan_id === 'string' ? details.requested_plan_id : null,
          proposal: proposal ? {
            version: proposal.version,
            status: effectiveProposalStatus(proposal, now),
            plan_id: proposal.plan_id,
            plan_name: proposal.plan_snapshot.name,
            price: proposal.plan_snapshot.price,
            currency: proposal.plan_snapshot.currency,
            collaboration_account: proposal.collaboration_account,
            event: proposal.campaign_snapshot.event,
            issued_at: proposal.issued_at,
            valid_until: proposal.valid_until,
            accept_by: proposal.accept_by,
            accept_deadline: effectiveAcceptanceDeadline(proposal).toISOString(),
            accepted_at: proposal.accepted_at ?? null,
            title: proposal.title,
            content: proposal.content,
          } : null,
          history_count: details.proposal_history?.length ?? 0,
        }
      }),
    },
  })
}

type Body = {
  action?: 'preview' | 'issue' | 'withdraw'
  brand_id?: string
  plan_id?: string
  collaboration_account?: string
  event?: { name?: string; date?: string; start_time?: string; location?: string }
  replace_accepted?: boolean
  application_id?: string
}

export async function POST(request: NextRequest, { params }: Params) {
  const result = await authorize(params.id)
  if ('error' in result) return result.error
  const { user, auth } = result
  const { admin } = auth
  const body = await request.json().catch(() => ({})) as Body

  if (body.action === 'withdraw') {
    if (!body.application_id) return NextResponse.json({ error: 'application_id requerido' }, { status: 422 })
    const { data: row, error } = await admin.from('campaign_brand_applications')
      .select('id, details, updated_at').eq('id', body.application_id).eq('campaign_id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Propuesta no encontrada' }, { status: 404 })
    const transition = applyWithdraw(readApplicationDetails(row.details), { userId: user.id })
    if (!transition.ok) return NextResponse.json({ error: transition.error }, { status: transition.status })
    const { data: updated, error: updateError } = await admin.from('campaign_brand_applications')
      .update({ details: transition.details, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    if (!updated?.length) return NextResponse.json({ error: 'La propuesta cambió mientras la editabas. Recarga e intenta de nuevo.' }, { status: 409 })
    return NextResponse.json({ data: { status: transition.proposal.status } })
  }

  if (body.action !== 'preview' && body.action !== 'issue') return NextResponse.json({ error: 'Acción inválida' }, { status: 422 })
  if (!body.brand_id || !body.plan_id) return NextResponse.json({ error: 'Marca y plan son obligatorios' }, { status: 422 })

  const { data: campaign, error: campaignError } = await admin.from('campaigns')
    .select('id, name, description, brand_id, metadata').eq('id', params.id).single()
  if (campaignError || !campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  // D6 = NO: solo oportunidades publicadas (enabled) con planes.
  const view = readOpportunity(campaign.metadata)
  if (!view || view.mode !== 'plans' || !view.enabled) {
    return NextResponse.json({ error: 'Activa "Publicar a marcas" y configura planes antes de emitir propuestas.' }, { status: 409 })
  }
  const plan = view.plans.find(p => p.id === body.plan_id)
  if (!plan || !plan.active) return NextResponse.json({ error: 'El plan no existe o está desactivado.' }, { status: 409 })

  const { data: brand, error: brandError } = await admin.from('brands')
    .select('id, name, instagram, contact_email').eq('id', body.brand_id).maybeSingle()
  if (brandError) return NextResponse.json({ error: brandError.message }, { status: 500 })
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (brand.id === campaign.brand_id) return NextResponse.json({ error: 'No se puede emitir una propuesta a la marca dueña de la campaña.' }, { status: 409 })
  if (!brand.contact_email) return NextResponse.json({ error: 'La marca no tiene email de contacto: complétalo antes de emitir.', field: 'contact_email' }, { status: 422 })

  let account: string | null
  try {
    account = normalizeCollaborationAccount(body.collaboration_account)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cuenta inválida', field: 'collaboration_account' }, { status: 422 })
  }
  if (plan.collaboration_included && !account) {
    return NextResponse.json({ error: 'El plan incluye Collab: confirma la cuenta de colaboración (ej. @marca).', field: 'collaboration_account' }, { status: 422 })
  }

  // Evento: override del Admin (golden case / booking aún sin corregir) o
  // datos reales del booking. Nunca se escribe de vuelta en bookings.
  let defaults: { name?: string; date?: string; startTime?: string; location?: string } = {}
  try { defaults = (await buildCampaignContractContext(admin, { campaignId: params.id })).meta.eventDefaults } catch { defaults = {} }
  const override = body.event ?? {}
  const pick = (value: string | undefined, fallback: string | undefined) => (value?.trim() || fallback?.trim() || null)
  const event: ProposalEventSnapshot = {
    name: pick(override.name, defaults.name ?? campaign.name),
    date: pick(override.date, defaults.date),
    start_time: pick(override.start_time, defaults.startTime),
    location: pick(override.location, defaults.location),
    source: [override.name, override.date, override.start_time, override.location].some(v => v && v.trim()) ? 'override' : 'booking',
  }
  if (event.date && !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return NextResponse.json({ error: 'Fecha del evento inválida (YYYY-MM-DD)', field: 'event.date' }, { status: 422 })

  const { data: existing, error: existingError } = await admin.from('campaign_brand_applications')
    .select('id, status, details, updated_at').eq('campaign_id', params.id).eq('brand_id', brand.id).maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (existing && (existing.status === 'active' || existing.status === 'approved_for_payment')) {
    return NextResponse.json({ error: 'Esta marca ya está en otro estado del flujo de colaboración (aprobada o activa).' }, { status: 409 })
  }

  const now = new Date()
  let transition
  try {
    transition = applyIssue(readApplicationDetails(existing?.details), {
      plan_id: plan.id,
      plan_snapshot: toPlanSnapshot(plan, now),
      collaboration_account: account,
      brand_snapshot: { id: brand.id, name: brand.name },
      campaign_snapshot: { id: campaign.id, name: campaign.name, description: campaign.description ?? null, event },
      issued_at: now.toISOString(),
      issued_by: user.id,
    }, { replaceAccepted: body.replace_accepted === true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo generar la propuesta' }, { status: 422 })
  }
  if (!transition.ok) return NextResponse.json({ error: transition.error }, { status: transition.status })

  if (body.action === 'preview') {
    return NextResponse.json({ data: { title: transition.proposal.title, content: transition.proposal.content, version: transition.proposal.version, valid_until: transition.proposal.valid_until, accept_by: transition.proposal.accept_by } })
  }

  let applicationId: string
  if (existing) {
    const { data: updated, error: updateError } = await admin.from('campaign_brand_applications')
      .update({ details: transition.details, status: 'pending', updated_at: now.toISOString() })
      .eq('id', existing.id).eq('updated_at', existing.updated_at).select('id')
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    if (!updated?.length) return NextResponse.json({ error: 'La postulación cambió mientras emitías. Recarga e intenta de nuevo.' }, { status: 409 })
    applicationId = existing.id
  } else {
    const { data: inserted, error: insertError } = await admin.from('campaign_brand_applications')
      .insert({ campaign_id: campaign.id, brand_id: brand.id, status: 'pending', details: transition.details })
      .select('id').single()
    if (insertError) {
      const status = insertError.code === '23505' ? 409 : 500
      return NextResponse.json({ error: status === 409 ? 'La marca acaba de postular. Recarga e intenta de nuevo.' : insertError.message }, { status })
    }
    applicationId = inserted.id
  }

  const delivery = await notifyBrandProposalIssued(admin, { brand, proposal: transition.proposal, applicationId })
  return NextResponse.json({ data: { application_id: applicationId, version: transition.proposal.version, status: 'sent', ...delivery } }, { status: 201 })
}
