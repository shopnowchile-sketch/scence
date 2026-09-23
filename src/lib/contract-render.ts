import type { SupabaseClient } from '@supabase/supabase-js'

// ── Contract rendering context ──────────────────────────────────────────────
// Resuelve las variables de un contrato de campaña/marca a partir de datos
// REALES ya existentes: campaigns, brands, campaign_brands, bookings.
// Reutiliza renderDocument()/templateVariables() de document-templates.ts —
// este archivo solo arma el objeto `values` que esas funciones consumen.
//
// No inventa datos: cualquier dato que no exista en la campaña/marca/booking
// queda `undefined`, y renderDocument() lo reemplaza por el marcador
// "________________" (mismo comportamiento que el NDA de marca).

const TZ = 'America/Santiago'

const CAMPAIGN_TYPE_LABELS_ES: Record<string, string> = {
  sponsored_post: 'Post Patrocinado',
  event_appearance: 'Aparición en Evento',
  ambassador: 'Embajador',
  product_seeding: 'Product Seeding',
  ugc: 'UGC',
  live: 'Live / Stream',
  commission: 'Comisión',
}

const PAYMENT_CONDITION_LABELS: Record<string, string> = {
  before_event: 'antes de la realización del evento',
  after_event: 'después de la realización del evento',
  on_signing: 'a la firma del presente acuerdo',
  on_publish: 'al momento de la publicación del contenido',
}

function conditionLabel(value?: string): string | undefined {
  if (!value) return undefined
  return PAYMENT_CONDITION_LABELS[value] ?? value
}

function formatDateEs(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('es-CL', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatTimeEs(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return `${new Intl.DateTimeFormat('es-CL', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false }).format(date)} hrs`
}

function formatDateOnlyEs(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return formatDateEs(value)
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function isoDateInTz(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const y = parts.find(p => p.type === 'year')?.value
  const mo = parts.find(p => p.type === 'month')?.value
  const d = parts.find(p => p.type === 'day')?.value
  return y && mo && d ? `${y}-${mo}-${d}` : undefined
}

function timeInTz(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function formatMoney(amount: number | null | undefined, currency = 'CLP'): string | undefined {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return undefined
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

function brandAddress(brand: BrandRow | null | undefined): string | undefined {
  if (!brand) return undefined
  const parts = [brand.address_street, brand.address_number, brand.address_city, brand.address_region, brand.address_country].filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

function brandContact(brand: BrandRow | null | undefined): string | undefined {
  if (!brand) return undefined
  if (brand.contact_name && brand.contact_email) return `${brand.contact_name} (${brand.contact_email})`
  return brand.contact_name ?? brand.contact_email ?? undefined
}

function bulletList(items: string[] | undefined): string | undefined {
  if (!items || items.length === 0) return undefined
  const clean = items.map(i => i.trim()).filter(Boolean)
  return clean.length ? clean.map(i => `- ${i}`).join('\n') : undefined
}

export type ContractPackageInput = {
  name?: string
  amount?: number
  currency?: string
  description?: string
  inclusions?: string[]
  requirements?: string[]
  deliverables?: string[]
}

export type ContractPaymentInput = {
  first_percentage?: number
  first_condition?: string
  second_percentage?: number
  second_condition?: string
}

export type ContractGenerationParams = {
  campaignId: string
  partnerBrandId?: string | null
  // Datos de evento ingresados manualmente por el Admin en el modal de
  // generación. Tienen prioridad sobre el booking real y sobre
  // campaign.metadata, pero NUNCA se escriben de vuelta en `bookings`
  // (ver contracts.metadata.event para el snapshot congelado).
  eventOverride?: {
    name?: string
    date?: string // 'YYYY-MM-DD'
    startTime?: string // 'HH:MM'
    endTime?: string // 'HH:MM'
    location?: string
  }
  package?: ContractPackageInput
  payment?: ContractPaymentInput
  usagePeriod?: string
  terminationNoticeDays?: string | number
  campaignObjective?: string
  primaryBrandResponsibilities?: string
  partnerBrandResponsibilities?: string
  billingTerms?: string
}

type BrandRow = {
  id: string
  name: string
  rut: string | null
  contact_name: string | null
  contact_email: string | null
  address_street: string | null
  address_number: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
}

const BRAND_SELECT = 'id,name,rut,contact_name,contact_email,address_street,address_number,address_city,address_region,address_country'

function composePaymentTerms(payment: ContractPaymentInput | undefined, totalAmount: number | undefined, currency: string): string | undefined {
  if (!payment?.first_percentage || !payment?.second_percentage) return undefined
  const firstAmount = totalAmount !== undefined ? formatMoney(Math.round((totalAmount * payment.first_percentage) / 100), currency) : undefined
  const secondAmount = totalAmount !== undefined ? formatMoney(Math.round((totalAmount * payment.second_percentage) / 100), currency) : undefined
  const firstCond = conditionLabel(payment.first_condition)
  const secondCond = conditionLabel(payment.second_condition)
  return `Las Partes acuerdan que el monto total será pagado de la siguiente forma: un ${payment.first_percentage}%${firstAmount ? ` (${firstAmount})` : ''}${firstCond ? ` ${firstCond}` : ''}, y el ${payment.second_percentage}% restante${secondAmount ? ` (${secondAmount})` : ''}${secondCond ? ` ${secondCond}` : ''}.`
}

export type ContractContextResult = {
  context: Record<string, string | undefined>
  meta: {
    campaign: { id: string; name: string; type: string; start_date: string | null; end_date: string | null; organization_id: string }
    primaryBrand: BrandRow | null
    partnerBrand: BrandRow | null
    booking: { id: string; title: string; location: string | null; starts_at: string; ends_at: string } | null
    campaignBrandId: string | null
    multipleBookings: boolean
    // Valores tal como existen hoy en el booking real / campaign.metadata,
    // sin override del Admin. El frontend los usa para precargar el
    // formulario de "Datos del evento" (el Admin puede corregirlos).
    eventDefaults: { name?: string; date?: string; startTime?: string; endTime?: string; location?: string }
  }
}

/** Arma el contexto de variables de un contrato a partir de datos reales de la campaña. No inventa datos: lo que falte queda sin resolver. */
export async function buildCampaignContractContext(
  admin: SupabaseClient,
  params: ContractGenerationParams,
): Promise<ContractContextResult> {
  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, name, description, type, start_date, end_date, brand_id, organization_id, currency, address, metadata')
    .eq('id', params.campaignId)
    .single()
  if (campaignError || !campaign) throw new Error('Campaña no encontrada')

  const [{ data: primaryBrand }, { data: bookings }] = await Promise.all([
    campaign.brand_id
      ? admin.from('brands').select(BRAND_SELECT).eq('id', campaign.brand_id).maybeSingle()
      : Promise.resolve({ data: null as BrandRow | null }),
    admin.from('bookings').select('id, title, location, starts_at, ends_at').eq('campaign_id', params.campaignId).order('starts_at', { ascending: true }),
  ])

  let partnerBrand: BrandRow | null = null
  let campaignBrandId: string | null = null
  if (params.partnerBrandId) {
    const [{ data: brand }, { data: cb }] = await Promise.all([
      admin.from('brands').select(BRAND_SELECT).eq('id', params.partnerBrandId).maybeSingle(),
      admin.from('campaign_brands').select('id').eq('campaign_id', params.campaignId).eq('brand_id', params.partnerBrandId).maybeSingle(),
    ])
    partnerBrand = brand ?? null
    campaignBrandId = cb?.id ?? null
  }

  const booking = bookings?.[0] ?? null
  const metadata = (campaign.metadata && typeof campaign.metadata === 'object' ? campaign.metadata as Record<string, unknown> : {})

  const pkg = params.package
  const currency = pkg?.currency || campaign.currency || 'CLP'
  const totalAmount = pkg?.amount

  const deliverablesText = bulletList(pkg?.deliverables)

  const eventOverride = params.eventOverride

  const context: Record<string, string | undefined> = {
    // PARTES
    primary_brand_name: primaryBrand?.name,
    primary_brand_rut: primaryBrand?.rut ?? undefined,
    primary_brand_address: brandAddress(primaryBrand),
    primary_brand_contact: brandContact(primaryBrand),

    partner_brand_name: partnerBrand?.name,
    partner_brand_rut: partnerBrand?.rut ?? undefined,
    partner_brand_address: brandAddress(partnerBrand),
    partner_brand_contact: brandContact(partnerBrand),

    // CAMPAÑA
    campaign_name: campaign.name,
    campaign_description: campaign.description ?? undefined,
    campaign_objective: params.campaignObjective || campaign.description || undefined,
    campaign_type: CAMPAIGN_TYPE_LABELS_ES[campaign.type as string] ?? (campaign.type as string | undefined),
    campaign_start_date: formatDateOnlyEs(campaign.start_date),
    campaign_end_date: formatDateOnlyEs(campaign.end_date),
    // Nombres legacy usados por el template "CONTRATO MARCA" ya existente en producción.
    start_date: formatDateOnlyEs(campaign.start_date),
    end_date: formatDateOnlyEs(campaign.end_date),

    // EVENTO — prioridad: dato de evento ingresado por el Admin en este
    // contrato > booking real > campaign.metadata. Nunca se inventa: si
    // ninguna de las tres fuentes tiene el dato, queda sin resolver.
    event_name: eventOverride?.name?.trim() || booking?.title,
    event_date: eventOverride?.date?.trim()
      ? formatDateOnlyEs(eventOverride.date.trim())
      : formatDateOnlyEs(booking?.starts_at ?? (metadata.event_date as string | undefined)),
    event_start_time: eventOverride?.startTime?.trim() ? `${eventOverride.startTime.trim()} hrs` : formatTimeEs(booking?.starts_at),
    event_end_time: eventOverride?.endTime?.trim() ? `${eventOverride.endTime.trim()} hrs` : formatTimeEs(booking?.ends_at),
    // Prioridad: dato ingresado en este contrato > booking real > campaigns.address (la misma columna real que usa "Editar ubicación" en el header de la campaña — no metadata, que nunca se llena para esto).
    event_location: eventOverride?.location?.trim() || booking?.location || campaign.address || (metadata.address as string | undefined),

    // PAQUETE — viene del formulario de generación (no hay tabla de paquetes hoy).
    package_name: pkg?.name,
    package_amount: formatMoney(pkg?.amount, currency),
    package_currency: currency,
    package_description: pkg?.description,
    package_inclusions: bulletList(pkg?.inclusions),
    package_requirements: bulletList(pkg?.requirements),
    package_deliverables: deliverablesText,
    // Nombre legacy usado por "CONTRATO MARCA".
    deliverables: deliverablesText,

    // PAGO
    total_amount: formatMoney(totalAmount, currency),
    currency,
    billing_terms: params.billingTerms,
    payment_terms: composePaymentTerms(params.payment, totalAmount, currency),
    first_payment_percentage: params.payment?.first_percentage?.toString(),
    first_payment_amount: totalAmount !== undefined && params.payment?.first_percentage
      ? formatMoney(Math.round((totalAmount * params.payment.first_percentage) / 100), currency) : undefined,
    first_payment_condition: conditionLabel(params.payment?.first_condition),
    second_payment_percentage: params.payment?.second_percentage?.toString(),
    second_payment_amount: totalAmount !== undefined && params.payment?.second_percentage
      ? formatMoney(Math.round((totalAmount * params.payment.second_percentage) / 100), currency) : undefined,
    second_payment_condition: conditionLabel(params.payment?.second_condition),

    // OTRAS CONDICIONES
    usage_period: params.usagePeriod,
    termination_notice_days: params.terminationNoticeDays !== undefined ? String(params.terminationNoticeDays) : undefined,
    primary_brand_responsibilities: params.primaryBrandResponsibilities,
    partner_brand_responsibilities: params.partnerBrandResponsibilities,

    // FIRMA
    signature_date: formatDateEs(new Date().toISOString()),
  }

  return {
    context,
    meta: {
      campaign: { id: campaign.id, name: campaign.name, type: campaign.type, start_date: campaign.start_date, end_date: campaign.end_date, organization_id: campaign.organization_id },
      primaryBrand: primaryBrand ?? null,
      partnerBrand,
      booking: booking ?? null,
      campaignBrandId,
      multipleBookings: (bookings?.length ?? 0) > 1,
      eventDefaults: {
        name: booking?.title ?? undefined,
        date: isoDateInTz(booking?.starts_at) ?? (metadata.event_date as string | undefined),
        startTime: timeInTz(booking?.starts_at),
        endTime: timeInTz(booking?.ends_at),
        location: booking?.location ?? campaign.address ?? (metadata.address as string | undefined),
      },
    },
  }
}
