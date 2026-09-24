// ── Propuesta comercial para marcas — FUENTE ÚNICA ────────────────────────────
// La propuesta vive en campaign_brand_applications.details.proposal (sin
// tabla nueva). Congela el plan (snapshot), la cuenta Collab, el evento y el
// texto al emitirse; nunca se vuelve a calcular desde el plan vivo.
//
// Reglas de negocio aprobadas (no cambiar sin autorización):
//   · vigencia: 7 días corridos desde la emisión;
//   · aceptación: dentro de 3 días hábiles desde la recepción (= emisión);
//   · plazo efectivo = el menor de ambos;
//   · estados: sent → accepted | withdrawn | superseded | expired (calculado);
//   · la propuesta presenta un PLAN DE ACTIVACIÓN DE MARCA: sin publicaciones
//     garantizadas, sin exclusividad salvo acuerdo escrito, Collab gestionada
//     por SCENCE y sujeta a aceptación de terceros.
// Nada de este archivo lee PDFs ni usa IA.

import type { SupabaseClient } from '@supabase/supabase-js'
import { businessDaysDeadline, calendarDaysDeadline, BUSINESS_TIME_ZONE } from './business-days'
import {
  ACTIVATION_DYNAMICS_CLAUSE,
  COMMERCIAL_MODEL,
  NO_GUARANTEED_PUBLICATIONS_CLAUSE,
  NON_EXCLUSIVITY_CLAUSE,
  collaborationClause,
  formatPlanMoney,
  paymentTermLines,
  planScopeLines,
  type BrandPlanSnapshot,
} from './brand-plans'

export const PROPOSAL_VALIDITY_CALENDAR_DAYS = 7
export const PROPOSAL_ACCEPTANCE_BUSINESS_DAYS = 3
export const PROPOSAL_RENDERER_VERSION = 'proposal-v1'

export type ProposalStatus = 'sent' | 'accepted' | 'withdrawn' | 'superseded' | 'expired'

export type ProposalEventSnapshot = {
  name: string | null
  date: string | null        // 'YYYY-MM-DD'
  start_time: string | null  // 'HH:MM'
  location: string | null
  source: 'booking' | 'override'
}

export type ProposalCampaignSnapshot = {
  id: string
  name: string
  description: string | null
  event: ProposalEventSnapshot
}

export type ProposalRecord = {
  version: number
  status: ProposalStatus
  plan_id: string
  plan_snapshot: BrandPlanSnapshot
  collaboration_account: string | null
  brand_snapshot: { id: string; name: string }
  campaign_snapshot: ProposalCampaignSnapshot
  commercial_model: typeof COMMERCIAL_MODEL
  issued_at: string
  issued_by: string
  valid_until: string
  accept_by: string
  title: string
  content: string
  renderer_version: string
  accepted_at?: string
  accepted_by?: string
  acceptance_ip?: string | null
  withdrawn_at?: string
  withdrawn_by?: string
  superseded_at?: string
  expired_at?: string
  contract_id?: string
}

export type ApplicationDetails = Record<string, unknown> & {
  proposal?: ProposalRecord
  proposal_history?: ProposalRecord[]
}

// ── Fechas ───────────────────────────────────────────────────────────────────
export function computeProposalDeadlines(issuedAt: Date): { valid_until: string; accept_by: string } {
  return {
    valid_until: calendarDaysDeadline(issuedAt, PROPOSAL_VALIDITY_CALENDAR_DAYS).toISOString(),
    accept_by: businessDaysDeadline(issuedAt, PROPOSAL_ACCEPTANCE_BUSINESS_DAYS).toISOString(),
  }
}

/** Plazo efectivo para aceptar: el menor entre vigencia y plazo de aceptación. */
export function effectiveAcceptanceDeadline(record: Pick<ProposalRecord, 'valid_until' | 'accept_by'>): Date {
  return new Date(Math.min(new Date(record.valid_until).getTime(), new Date(record.accept_by).getTime()))
}

/** Estado real: una propuesta 'sent' pasado el plazo efectivo está 'expired'. */
export function effectiveProposalStatus(record: ProposalRecord, now: Date = new Date()): ProposalStatus {
  if (record.status === 'sent' && now.getTime() > effectiveAcceptanceDeadline(record).getTime()) return 'expired'
  return record.status
}

export function formatProposalDateTime(iso: string): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    timeZone: BUSINESS_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
  return `${text} hrs, hora de Chile`
}

function formatEventDate(isoDate: string | null): string | null {
  if (!isoDate) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return isoDate
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
}

// ── Render de las 10 secciones ───────────────────────────────────────────────
export type ProposalRenderInput = Pick<ProposalRecord,
  'plan_snapshot' | 'collaboration_account' | 'brand_snapshot' | 'campaign_snapshot' | 'issued_at' | 'valid_until' | 'accept_by' | 'version'>

export function proposalTitle(input: Pick<ProposalRecord, 'campaign_snapshot' | 'plan_snapshot'>): string {
  return `Propuesta comercial — ${input.campaign_snapshot.name} · Plan ${input.plan_snapshot.name}`
}

/**
 * Texto completo de la propuesta. Determinista: mismo input → mismo texto.
 * Lanza si el plan incluye Collab y no hay cuenta confirmada.
 */
export function renderBrandProposal(input: ProposalRenderInput): string {
  const plan = input.plan_snapshot
  const brand = input.brand_snapshot.name
  const campaign = input.campaign_snapshot
  const account = input.collaboration_account
  const scope = planScopeLines(plan, account)
  const price = formatPlanMoney(plan.price, plan.currency)
  const bullets = (items: string[]) => items.map(item => `- ${item}`).join('\n')
  const event = campaign.event
  const eventLine = [event.name, formatEventDate(event.date), event.start_time ? `${event.start_time} hrs` : null, event.location].filter(Boolean).join(' · ')

  const scenceScope = ['Coordinar la activación de la marca dentro de la dinámica del evento.']
  if (plan.stand_included) scenceScope.push('Disponer el espacio de stand de la marca dentro del evento.')
  if (plan.brand_brief_included) scenceScope.push('Recibir el brief de la marca y comunicarlo a las influencers participantes de la activación.')
  if (plan.influencer_content_included) scenceScope.push('Coordinar la dinámica en la que las influencers participantes generan contenido durante el evento.')
  scenceScope.push(collaborationClause(plan.collaboration_included, account))

  const brandDuties = ['Entregar oportunamente la información y los materiales necesarios para su activación.']
  if (plan.brand_brief_included) brandDuties.push('Entregar su brief de marca dentro del plazo que SCENCE indique.')
  if (plan.stand_included) brandDuties.push('Implementar y atender su stand en los horarios que se coordinen con SCENCE.')
  if (plan.collaboration_included) brandDuties.push(`Revisar las solicitudes de colaboración (Collab) que reciba la cuenta ${account} y decidir si las acepta.`)
  brandDuties.push('Cumplir las condiciones de pago que se formalicen en el contrato.')

  const sections = [
    `${proposalTitle(input).toUpperCase()}\nPara: ${brand}\nVersión: ${input.version}\nEmitida: ${formatProposalDateTime(input.issued_at)}\nVigente hasta: ${formatProposalDateTime(input.valid_until)}\nAceptar antes de: ${formatProposalDateTime(effectiveAcceptanceDeadline(input).toISOString())}`,
    `01 — RESUMEN DE LA PROPUESTA\nSCENCE propone a ${brand} participar en ${campaign.name} con el plan ${plan.name}, por un monto total de ${price} (${plan.currency}).\nLo que se contrata es un plan de activación de marca dentro del evento, no una cantidad de publicaciones.`,
    `02 — SOBRE ${campaign.name.toUpperCase()}\n${[campaign.description, eventLine ? `Evento: ${eventLine}` : null].filter(Boolean).join('\n') || 'Los detalles del evento se confirmarán en el contrato.'}`,
    `03 — PLAN ${plan.name.toUpperCase()}\n${plan.description ? `${plan.description}\n` : ''}Incluye:\n${bullets(scope.included)}${plan.additional_terms ? `\nCondiciones adicionales: ${plan.additional_terms}` : ''}`,
    `04 — DINÁMICA DE INFLUENCERS Y CONTENIDO\n${ACTIVATION_DYNAMICS_CLAUSE}\n${NO_GUARANTEED_PUBLICATIONS_CLAUSE}\n${NON_EXCLUSIVITY_CLAUSE}`,
    `05 — ALCANCE DE SCENCE\n${bullets(scenceScope)}`,
    `06 — RESPONSABILIDADES DE LA MARCA\n${bullets(brandDuties)}`,
    `07 — INVERSIÓN Y CONDICIONES COMERCIALES\nMonto total: ${price} (${plan.currency}).\nForma de pago:\n${bullets(paymentTermLines(plan.payment_terms, plan.price, plan.currency))}\nLas condiciones de pago se formalizan en el contrato.`,
    `08 — EXCLUSIONES Y CAMBIOS DE ALCANCE\n${bullets([
      ...scope.excluded.map(item => `No incluido: ${item}.`),
      'Cualquier prestación no descrita expresamente en la sección 03.',
      'SCENCE no garantiza un número determinado de publicaciones, piezas de contenido, alcances ni resultados.',
      'La participación de las influencers no implica exclusividad respecto de la marca, salvo acuerdo escrito específico.',
      'La aceptación de solicitudes de colaboración (Collab) depende de la marca y/o de terceros; SCENCE no garantiza su aceptación.',
      'Todo cambio de alcance requiere acuerdo escrito entre las partes y puede modificar el monto.',
    ])}`,
    `09 — PRÓXIMOS PASOS\n1. ${brand} acepta esta propuesta antes del plazo indicado.\n2. SCENCE envía el contrato definitivo.\n3. Las partes firman el contrato.\n4. Pagos según las condiciones del contrato.\n5. Coordinación de la activación${plan.brand_brief_included ? ' y entrega del brief' : ''}.`,
    `10 — ACEPTACIÓN DE LA PROPUESTA\nEsta propuesta tiene una vigencia de ${PROPOSAL_VALIDITY_CALENDAR_DAYS} días corridos desde su emisión (hasta el ${formatProposalDateTime(input.valid_until)}).\nPara avanzar con la contratación y mantener las condiciones propuestas, la marca debe aceptarla dentro de ${PROPOSAL_ACCEPTANCE_BUSINESS_DAYS} días hábiles desde su recepción (hasta el ${formatProposalDateTime(input.accept_by)}).\nLa aceptación de esta propuesta no reemplaza al contrato: el contrato definitivo formaliza obligaciones, alcance, precio y forma de pago.`,
  ]
  return sections.join('\n\n')
}

// ── Transiciones (puras) ─────────────────────────────────────────────────────
export type ProposalTransition =
  | { ok: true; details: ApplicationDetails; proposal: ProposalRecord }
  | { ok: false; status: 404 | 409 | 422; error: string; details?: ApplicationDetails }

type IssueInput = Omit<ProposalRecord, 'version' | 'status' | 'valid_until' | 'accept_by' | 'content' | 'title' | 'renderer_version' | 'commercial_model'>

/**
 * Emite (o reemite) la propuesta. La versión anterior pasa a
 * proposal_history como 'superseded' (o conserva 'withdrawn'). Una propuesta
 * aceptada solo se reemplaza con confirmación explícita y nunca si ya tiene
 * contrato.
 */
export function applyIssue(details: ApplicationDetails | null | undefined, input: IssueInput, options: { replaceAccepted?: boolean } = {}): ProposalTransition {
  const base: ApplicationDetails = { ...(details ?? {}) }
  const current = base.proposal
  const history = [...(base.proposal_history ?? [])]
  const now = new Date(input.issued_at)
  if (current) {
    if (current.contract_id) return { ok: false, status: 409, error: 'La propuesta vigente ya tiene contrato; no puede reemplazarse.' }
    const status = effectiveProposalStatus(current, now)
    if (status === 'accepted' && !options.replaceAccepted) {
      return { ok: false, status: 409, error: 'La marca ya aceptó esta propuesta. Confirma explícitamente para reemplazarla por una nueva versión.' }
    }
    history.push(status === 'withdrawn' ? current : { ...current, status: 'superseded', superseded_at: input.issued_at })
  }
  const version = Math.max(0, ...history.map(p => p.version), current?.version ?? 0) + 1
  const deadlines = computeProposalDeadlines(now)
  const draft = { ...input, version, ...deadlines }
  const proposal: ProposalRecord = {
    ...draft,
    status: 'sent',
    commercial_model: COMMERCIAL_MODEL,
    title: proposalTitle(draft),
    content: renderBrandProposal(draft),
    renderer_version: PROPOSAL_RENDERER_VERSION,
  }
  return { ok: true, proposal, details: { ...base, proposal, proposal_history: history } }
}

export function applyWithdraw(details: ApplicationDetails | null | undefined, actor: { userId: string; now?: Date }): ProposalTransition {
  const current = details?.proposal
  if (!current) return { ok: false, status: 404, error: 'No hay propuesta para retirar.' }
  const now = actor.now ?? new Date()
  const status = effectiveProposalStatus(current, now)
  if (status !== 'sent' && status !== 'expired') return { ok: false, status: 409, error: `No se puede retirar una propuesta en estado "${status}".` }
  const proposal: ProposalRecord = { ...current, status: 'withdrawn', withdrawn_at: now.toISOString(), withdrawn_by: actor.userId }
  return { ok: true, proposal, details: { ...details, proposal } }
}

/**
 * Aceptación por la marca. Fuera de plazo devuelve 409 y, en `details`, la
 * propuesta marcada 'expired' para persistirla.
 */
export function applyAccept(details: ApplicationDetails | null | undefined, actor: { userId: string; ip?: string | null; now?: Date }): ProposalTransition {
  const current = details?.proposal
  if (!current) return { ok: false, status: 404, error: 'Propuesta no encontrada.' }
  const now = actor.now ?? new Date()
  const status = effectiveProposalStatus(current, now)
  if (status === 'expired') {
    const expired: ProposalRecord = { ...current, status: 'expired', expired_at: now.toISOString() }
    return { ok: false, status: 409, error: `La propuesta venció el ${formatProposalDateTime(effectiveAcceptanceDeadline(current).toISOString())}. Pide a SCENCE una nueva versión.`, details: { ...details, proposal: expired } }
  }
  if (status !== 'sent') return { ok: false, status: 409, error: status === 'accepted' ? 'La propuesta ya fue aceptada.' : 'Esta propuesta ya no está disponible.' }
  const proposal: ProposalRecord = { ...current, status: 'accepted', accepted_at: now.toISOString(), accepted_by: actor.userId, acceptance_ip: actor.ip ?? null }
  return { ok: true, proposal, details: { ...details, proposal } }
}

// ── Vista para la marca ──────────────────────────────────────────────────────
export type BrandProposalView = Pick<ProposalRecord,
  'version' | 'plan_snapshot' | 'collaboration_account' | 'campaign_snapshot' | 'issued_at' | 'valid_until' | 'accept_by' | 'title' | 'content' | 'accepted_at'> & {
  status: ProposalStatus
  accept_deadline: string
}

/** Lo único que la marca ve de su propuesta: sin ids internos, IP ni historial. Oculta retiradas/reemplazadas. */
export function toBrandProposalView(record: ProposalRecord | null | undefined, now: Date = new Date()): BrandProposalView | null {
  if (!record) return null
  const status = effectiveProposalStatus(record, now)
  if (status === 'withdrawn' || status === 'superseded') return null
  return {
    version: record.version,
    status,
    plan_snapshot: record.plan_snapshot,
    collaboration_account: record.collaboration_account,
    campaign_snapshot: record.campaign_snapshot,
    issued_at: record.issued_at,
    valid_until: record.valid_until,
    accept_by: record.accept_by,
    accept_deadline: effectiveAcceptanceDeadline(record).toISOString(),
    title: record.title,
    content: record.content,
    accepted_at: record.accepted_at,
  }
}

export function readApplicationDetails(value: unknown): ApplicationDetails {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApplicationDetails : {}
}

// ── Acceso de marca (aislamiento A/B) ────────────────────────────────────────
/**
 * Única forma de que una ruta de MARCA cargue una postulación/propuesta:
 * siempre filtrada por brand_id de la marca autenticada. Una marca que pide
 * la propuesta de otra recibe null (404), nunca el dato.
 */
export async function loadBrandOwnApplication(admin: SupabaseClient, applicationId: string, brandId: string) {
  const { data, error } = await admin
    .from('campaign_brand_applications')
    .select('id, campaign_id, brand_id, status, details, updated_at')
    .eq('id', applicationId)
    .eq('brand_id', brandId)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; campaign_id: string; brand_id: string; status: string; details: unknown; updated_at: string } | null
}
