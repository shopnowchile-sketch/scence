import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { authorizeCampaignBrandAction } from '@/lib/campaign-brand-access'
import { renderDocument, templateVariables } from '@/lib/document-templates'
import { buildCampaignContractContext, type ContractPackageInput, type ContractPaymentInput } from '@/lib/contract-render'

// Campos legal/comercialmente obligatorios para un contrato de campaña/marca.
// Solo bloquean la generación cuando la plantilla elegida realmente los usa
// (se cruzan contra `missing`, que ya está acotado a las variables del
// template). No están aquí campos opcionales como billing_terms,
// usage_period, termination_notice_days o package_requirements.
const MASTER_REQUIRED_KEYS = [
  'primary_brand_name',
  'primary_brand_rut',
  'primary_brand_address',
  'partner_brand_name',
  'partner_brand_rut',
  'partner_brand_address',
  'campaign_name',
  'campaign_objective',
  'package_name',
  'total_amount',
  'payment_terms',
  'event_name',
  'event_date',
  'event_location',
]

// ── GET /api/contracts?campaign_id=... ──────────────────────────────────────
// Lista los contratos ya generados y guardados para una campaña. Solo Admin
// de plataforma (mismo gate que el resto de rutas admin de campaña).
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaignId = request.nextUrl.searchParams.get('campaign_id')
  if (!campaignId) return NextResponse.json({ error: 'campaign_id requerido' }, { status: 422 })

  const auth = await authorizeCampaignBrandAction(user.id, campaignId, 'campaign.read')
  if (!auth || !auth.isPlatformAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await auth.admin
    .from('contracts')
    .select('id, title, status, party_type, brand_id, campaign_brand_id, template_id, total_value, currency, start_date, end_date, created_at, metadata, brand:brands!brand_id(name)')
    .eq('campaign_id', campaignId)
    .eq('organization_id', auth.campaign.organization_id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/contracts]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? [] })
}

type GenerateBody = {
  campaign_id?: string
  template_id?: string
  partner_brand_id?: string | null
  package?: ContractPackageInput
  payment?: ContractPaymentInput
  // Datos de evento ingresados por el Admin en el modal cuando el booking
  // real no los tiene (o para corregirlos solo para efectos del contrato).
  // NUNCA se escriben en `bookings` — ver contract-render.ts eventOverride.
  event?: { name?: string; date?: string; start_time?: string; end_time?: string; location?: string }
  usage_period?: string
  termination_notice_days?: string | number
  campaign_objective?: string
  primary_brand_responsibilities?: string
  partner_brand_responsibilities?: string
  billing_terms?: string
  dry_run?: boolean
}

// ── POST /api/contracts ──────────────────────────────────────────────────────
// dry_run: true  -> solo renderiza y devuelve preview + variables faltantes.
// dry_run: false -> renderiza Y guarda el snapshot en `contracts.content`.
// Reutiliza el motor existente (renderDocument/templateVariables) y la tabla
// `contracts` ya preparada para party_type='brand'. No crea tablas nuevas.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: GenerateBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.campaign_id || !body.template_id) {
    return NextResponse.json({ error: 'campaign_id y template_id son requeridos' }, { status: 422 })
  }

  const auth = await authorizeCampaignBrandAction(user.id, body.campaign_id, 'campaign.manage')
  if (!auth || !auth.isPlatformAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { admin, campaign } = auth

  const { data: template, error: templateError } = await admin
    .from('contract_templates')
    .select('id, name, content, campaign_type, document_type, version')
    .eq('id', body.template_id)
    .eq('organization_id', campaign.organization_id)
    .single()
  if (templateError || !template) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 })

  let result: Awaited<ReturnType<typeof buildCampaignContractContext>>
  try {
    result = await buildCampaignContractContext(admin, {
      campaignId: body.campaign_id,
      partnerBrandId: body.partner_brand_id ?? null,
      package: body.package,
      payment: body.payment,
      eventOverride: body.event
        ? { name: body.event.name, date: body.event.date, startTime: body.event.start_time, endTime: body.event.end_time, location: body.event.location }
        : undefined,
      usagePeriod: body.usage_period,
      terminationNoticeDays: body.termination_notice_days,
      campaignObjective: body.campaign_objective,
      primaryBrandResponsibilities: body.primary_brand_responsibilities,
      partnerBrandResponsibilities: body.partner_brand_responsibilities,
      billingTerms: body.billing_terms,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error resolviendo datos de la campaña' }, { status: 422 })
  }

  const { context, meta } = result
  const usedVariableKeys = templateVariables(template.content).map(v => v.slice(2, -2))
  const missing = usedVariableKeys.filter(key => !context[key] || String(context[key]).trim() === '')
  const missingRequired = missing.filter(key => MASTER_REQUIRED_KEYS.includes(key))
  const content = renderDocument(template.content, context)

  if (body.dry_run) {
    return NextResponse.json({
      data: {
        content,
        missing,
        missing_required: missingRequired,
        meta: {
          partner_brand: meta.partnerBrand?.name ?? null,
          booking: meta.booking?.title ?? null,
          multiple_bookings: meta.multipleBookings,
          // Valores reales del booking/campaign.metadata (sin override) para
          // que el modal precargue "Datos del evento" y el Admin solo
          // corrija lo que falte, sin inventar nada.
          event_defaults: meta.eventDefaults,
        },
      },
    })
  }

  // El backend es la única autoridad: aunque la UI ya bloquea el botón,
  // un contrato "final" nunca se guarda con datos legales/comerciales
  // obligatorios en blanco. No se inventa nada — se detiene y se informa
  // exactamente qué falta.
  if (missingRequired.length > 0) {
    return NextResponse.json({
      error: 'Faltan datos obligatorios para generar el contrato',
      missing_required: missingRequired,
    }, { status: 422 })
  }

  const { data: saved, error: insertError } = await admin
    .from('contracts')
    .insert({
      campaign_id: body.campaign_id,
      organization_id: campaign.organization_id,
      party_type: 'brand',
      brand_id: body.partner_brand_id ?? null,
      campaign_brand_id: meta.campaignBrandId,
      template_id: template.id,
      title: `${template.name} — ${meta.campaign.name}`,
      status: 'draft',
      total_value: body.package?.amount ?? null,
      currency: body.package?.currency ?? null,
      start_date: meta.campaign.start_date,
      end_date: meta.campaign.end_date,
      content,
      created_by: user.id,
      // Snapshot estructurado de lo efectivamente contratado en este INSERT.
      // Todos los valores salen de `body`/`context`/`meta` ya calculados en
      // este mismo request — nada se vuelve a resolver al leer el contrato
      // después (GET /api/contracts/[id] devuelve esta fila tal cual).
      metadata: {
        package: {
          name: body.package?.name ?? null,
          amount: body.package?.amount ?? null,
          currency: body.package?.currency ?? null,
          inclusions: body.package?.inclusions ?? [],
          requirements: body.package?.requirements ?? [],
          deliverables: body.package?.deliverables ?? [],
        },
        payment_terms: {
          type: body.payment?.first_percentage === 50 && body.payment?.second_percentage === 50 ? '50_50' : (body.payment ? 'custom' : null),
          first_percentage: body.payment?.first_percentage ?? null,
          first_condition: body.payment?.first_condition ?? null,
          first_amount: context.first_payment_amount ?? null,
          second_percentage: body.payment?.second_percentage ?? null,
          second_condition: body.payment?.second_condition ?? null,
          second_amount: context.second_payment_amount ?? null,
        },
        event: {
          name: context.event_name ?? null,
          date: context.event_date ?? null,
          start_time: context.event_start_time ?? null,
          end_time: context.event_end_time ?? null,
          location: context.event_location ?? null,
        },
        campaign: {
          id: meta.campaign.id,
          name: meta.campaign.name,
          type: meta.campaign.type,
          start_date: meta.campaign.start_date,
          end_date: meta.campaign.end_date,
        },
        usage_period: body.usage_period ?? null,
        termination_notice_days: body.termination_notice_days ?? null,
        generated_missing_fields: missing,
        generated_at: new Date().toISOString(),
      },
    })
    .select('id, title, status, content, created_at')
    .single()

  if (insertError) {
    console.error('[POST /api/contracts]', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ data: { ...saved, missing } }, { status: 201 })
}
