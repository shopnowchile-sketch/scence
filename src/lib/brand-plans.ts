// ── Planes comerciales para marcas — FUENTE ÚNICA ─────────────────────────────
// Los planes viven en campaigns.metadata.collaboration_opportunity.plans[]
// (sin tabla nueva). Este archivo es la única autoridad para:
//   · validar y normalizar planes (ids estables, sin borrado);
//   · el DTO público que ve una marca (sin internal_notes ni inactivos);
//   · el snapshot congelado que usarán propuesta y contrato;
//   · los textos protectores del modelo comercial;
//   · el ANEXO I del contrato de plan.
//
// Modelo comercial (decisión de negocio, no cambiar sin autorización):
// la marca compra un PLAN DE ACTIVACIÓN DE MARCA, no publicaciones. "10+
// influencers" es participación en la dinámica del evento, no publicaciones
// garantizadas; no hay exclusividad; SCENCE gestiona la solicitud de Collab
// pero su aceptación depende de la marca/terceros.
//
// Ningún nombre de plan se define aquí: los nombres son datos de cada campaña.

export const PLAN_CURRENCIES = ['CLP', 'USD'] as const
export type PlanCurrency = typeof PLAN_CURRENCIES[number]

// Condiciones de pago de un plan. Las dos primeras son las del modelo 50/50
// aprobado; las demás son las claves que contract-render.ts ya reconoce.
export const PLAN_PAYMENT_CONDITIONS = {
  within_3bd_of_contract_sent: 'dentro de los 3 días hábiles siguientes al envío del contrato',
  within_3bd_after_event: 'dentro de los 3 días hábiles siguientes a la finalización del evento',
  on_signing: 'a la firma del presente acuerdo',
  before_event: 'antes de la realización del evento',
  after_event: 'después de la realización del evento',
} as const
export type PlanPaymentCondition = keyof typeof PLAN_PAYMENT_CONDITIONS

export type BrandPlanPaymentTerms = {
  first_percentage: number
  first_condition: PlanPaymentCondition
  second_percentage: number
  second_condition: PlanPaymentCondition
}

export const DEFAULT_PLAN_PAYMENT_TERMS: BrandPlanPaymentTerms = {
  first_percentage: 50,
  first_condition: 'within_3bd_of_contract_sent',
  second_percentage: 50,
  second_condition: 'within_3bd_after_event',
}

export type BrandPlan = {
  id: string
  name: string
  description: string
  price: number
  currency: PlanCurrency
  active: boolean
  display_order: number
  benefits: string[]
  influencer_minimum: number | null
  influencer_minimum_label: string | null
  stand_included: boolean
  brand_brief_included: boolean
  influencer_content_included: boolean
  collaboration_included: boolean
  additional_terms: string
  internal_notes: string
  payment_terms: BrandPlanPaymentTerms
  created_at: string
  updated_at: string
}

/** Lo que una marca puede ver. Nunca incluye internal_notes. */
export type PublicBrandPlan = Omit<BrandPlan, 'internal_notes' | 'created_at' | 'updated_at'>

/** Plan congelado en propuesta/contrato. Mismo contenido que el DTO público. */
export type BrandPlanSnapshot = PublicBrandPlan & { snapshot_at: string }

export type PlanFieldError = { plan_index: number; plan_id?: string; field: string; message: string }

export type NormalizePlansResult =
  | { ok: true; plans: BrandPlan[] }
  | { ok: false; errors: PlanFieldError[] }

type NormalizeOptions = {
  now?: Date
  newId?: () => string
}

const MAX_PLANS = 20
const MAX_BENEFITS = 40
const MAX_TEXT = 4000
const MAX_SHORT_TEXT = 120

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function isPaymentCondition(value: unknown): value is PlanPaymentCondition {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAN_PAYMENT_CONDITIONS, value)
}

// ── Promesas prohibidas ──────────────────────────────────────────────────────
// Detecta, por oración, textos que prometen lo que el modelo comercial NO
// ofrece: publicaciones garantizadas/obligatorias, exclusividad, o aceptación
// garantizada de Collab. Una oración con negación explícita ("no", "sin",
// "ni") se considera aclaratoria y no se marca: así los propios textos
// protectores pasan la validación.
const PUBLICATION_WORDS = /(publicaci|publicar|posteo|\bposts?\b|\breels?\b|historias|\bstor(y|ies)\b|contenido)/i
const GUARANTEE_WORDS = /(garantiz|obligatori|compromete a publicar)/i
const COLLAB_WORDS = /(collab|colaboraci)/i
const ACCEPT_WORDS = /(acept|aprob)/i
const EXCLUSIVITY_WORDS = /exclusiv/i
// La exclusividad de categoría para la marca (p. ej. "única marca de bebidas")
// es un beneficio legítimo; lo prohibido es prometer exclusividad de influencers.
const INFLUENCER_WORDS = /(influencer|creador|creadora|embajador|embajadora)/i
const NEGATION = /(^|[\s,;:(¿¡"'])(no|sin|ni|nunca|jamás)(?=[\s,;:)?!."']|$)/i

export function findForbiddenPromises(input: string): string[] {
  if (!input) return []
  const sentences = input.split(/(?<=[.!?;\n])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  return sentences.filter(sentence => {
    if (NEGATION.test(sentence)) return false
    if (EXCLUSIVITY_WORDS.test(sentence) && INFLUENCER_WORDS.test(sentence)) return true
    if (!GUARANTEE_WORDS.test(sentence)) return false
    return PUBLICATION_WORDS.test(sentence) || (COLLAB_WORDS.test(sentence) && ACCEPT_WORDS.test(sentence))
  })
}

// ── Cuenta de colaboración ───────────────────────────────────────────────────
// Acepta "marca", "@marca" o una URL de instagram.com y devuelve
// "@marca". Devuelve null si está vacía y lanza si el formato es inválido.
export function normalizeCollaborationAccount(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(value)
  const handle = (fromUrl ? fromUrl[1] : value).replace(/^@+/, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle) || /^\.|\.$|\.\./.test(handle)) {
    throw new Error(`Cuenta de colaboración inválida: "${value}". Usa el formato @cuenta.`)
  }
  return `@${handle.toLowerCase()}`
}

// ── Normalización / validación ───────────────────────────────────────────────
/**
 * Valida la lista completa de planes que envía el Admin y la fusiona con los
 * planes ya guardados:
 *   · un plan con `id` existente se actualiza conservando id y created_at;
 *   · un plan sin `id` (o con id desconocido) se crea con id nuevo del servidor;
 *   · un plan guardado que no viene en la lista es un error: los planes no se
 *     borran, se desactivan (propuestas y contratos pueden referenciarlos).
 * Devuelve TODOS los errores, no solo el primero.
 */
export function normalizePlans(input: unknown, existing: BrandPlan[] = [], options: NormalizeOptions = {}): NormalizePlansResult {
  const now = (options.now ?? new Date()).toISOString()
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID())
  const errors: PlanFieldError[] = []

  if (!Array.isArray(input)) {
    return { ok: false, errors: [{ plan_index: -1, field: 'plans', message: 'plans debe ser una lista' }] }
  }
  if (input.length > MAX_PLANS) {
    return { ok: false, errors: [{ plan_index: -1, field: 'plans', message: `Máximo ${MAX_PLANS} planes por campaña` }] }
  }

  const existingById = new Map(existing.map(plan => [plan.id, plan]))
  const seenIds = new Set<string>()
  const seenNames = new Map<string, number>()
  const plans: BrandPlan[] = []

  input.forEach((rawPlan, index) => {
    const raw = asRecord(rawPlan)
    const fail = (field: string, message: string) => errors.push({ plan_index: index, plan_id: typeof raw.id === 'string' ? raw.id : undefined, field, message })

    const previous = typeof raw.id === 'string' ? existingById.get(raw.id) : undefined
    const id = previous?.id ?? newId()
    if (seenIds.has(id)) fail('id', 'Plan duplicado en la lista')
    seenIds.add(id)

    const name = text(raw.name, MAX_SHORT_TEXT)
    if (!name) fail('name', 'El nombre del plan es obligatorio')
    const nameKey = name.toLocaleLowerCase('es')
    if (name && seenNames.has(nameKey)) fail('name', `Ya existe otro plan llamado "${name}" en esta campaña`)
    if (name) seenNames.set(nameKey, index)

    const currency = (typeof raw.currency === 'string' ? raw.currency.toUpperCase() : 'CLP') as PlanCurrency
    if (!PLAN_CURRENCIES.includes(currency)) fail('currency', `Moneda no soportada: ${String(raw.currency)}`)

    const price = numberOrNull(raw.price)
    if (price === null || price <= 0) fail('price', 'El precio debe ser mayor a 0')
    else if (currency === 'CLP' && !Number.isInteger(price)) fail('price', 'El precio en CLP debe ser un entero, sin decimales')

    const displayOrder = numberOrNull(raw.display_order)
    const benefitsRaw = Array.isArray(raw.benefits) ? raw.benefits : typeof raw.benefits === 'string' ? raw.benefits.split('\n') : []
    const benefits = benefitsRaw.map(item => text(item, 300)).filter(Boolean)
    if (benefits.length > MAX_BENEFITS) fail('benefits', `Máximo ${MAX_BENEFITS} beneficios por plan`)

    const influencerMinimum = numberOrNull(raw.influencer_minimum)
    if (influencerMinimum !== null && (!Number.isInteger(influencerMinimum) || influencerMinimum < 1)) {
      fail('influencer_minimum', 'La cantidad de influencers debe ser un entero ≥ 1')
    }
    const influencerLabel = text(raw.influencer_minimum_label, 20) || (influencerMinimum ? `${influencerMinimum}+` : '')

    const rawTerms = asRecord(raw.payment_terms)
    const terms: BrandPlanPaymentTerms = {
      first_percentage: numberOrNull(rawTerms.first_percentage) ?? DEFAULT_PLAN_PAYMENT_TERMS.first_percentage,
      first_condition: isPaymentCondition(rawTerms.first_condition) ? rawTerms.first_condition : DEFAULT_PLAN_PAYMENT_TERMS.first_condition,
      second_percentage: numberOrNull(rawTerms.second_percentage) ?? DEFAULT_PLAN_PAYMENT_TERMS.second_percentage,
      second_condition: isPaymentCondition(rawTerms.second_condition) ? rawTerms.second_condition : DEFAULT_PLAN_PAYMENT_TERMS.second_condition,
    }
    if (rawTerms.first_condition !== undefined && !isPaymentCondition(rawTerms.first_condition)) fail('payment_terms.first_condition', 'Condición de pago no reconocida')
    if (rawTerms.second_condition !== undefined && !isPaymentCondition(rawTerms.second_condition)) fail('payment_terms.second_condition', 'Condición de pago no reconocida')
    const pctOk = [terms.first_percentage, terms.second_percentage].every(p => Number.isInteger(p) && p > 0 && p < 100)
    if (!pctOk || terms.first_percentage + terms.second_percentage !== 100) {
      fail('payment_terms', 'Los porcentajes de pago deben ser enteros entre 1 y 99 y sumar 100')
    }

    const description = text(raw.description)
    const additionalTerms = text(raw.additional_terms)
    // Textos visibles a la marca: no pueden prometer lo que el modelo no ofrece.
    const visibleTexts: Array<[string, string]> = [['description', description], ['additional_terms', additionalTerms], ...benefits.map((b, i) => [`benefits.${i}`, b] as [string, string])]
    for (const [field, value] of visibleTexts) {
      const hits = findForbiddenPromises(value)
      if (hits.length) fail(field, `Este texto promete algo que el plan no garantiza (publicaciones, exclusividad o aceptación de Collab): "${hits[0]}"`)
    }

    plans.push({
      id,
      name,
      description,
      price: price ?? 0,
      currency,
      active: raw.active === undefined ? true : bool(raw.active),
      display_order: displayOrder !== null && Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : index + 1,
      benefits,
      influencer_minimum: influencerMinimum,
      influencer_minimum_label: influencerLabel || null,
      stand_included: bool(raw.stand_included),
      brand_brief_included: bool(raw.brand_brief_included),
      influencer_content_included: bool(raw.influencer_content_included),
      collaboration_included: bool(raw.collaboration_included),
      additional_terms: additionalTerms,
      internal_notes: text(raw.internal_notes),
      payment_terms: terms,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    })
  })

  for (const plan of existing) {
    if (!seenIds.has(plan.id)) {
      errors.push({ plan_index: -1, plan_id: plan.id, field: 'plans', message: `El plan "${plan.name}" no puede eliminarse; desactívalo.` })
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, plans: sortPlans(plans) }
}

export function sortPlans<T extends Pick<BrandPlan, 'display_order' | 'name'>>(plans: T[]): T[] {
  return [...plans].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'es'))
}

// ── Lectura de la oportunidad (compatibilidad legacy) ────────────────────────
export type OpportunityView =
  | { mode: 'plans'; enabled: boolean; application_deadline: string | null; plans: BrandPlan[] }
  | { mode: 'legacy'; enabled: boolean; application_deadline: string | null; benefits: string; participation_value: number; currency: PlanCurrency; seats: number }

/**
 * Lee campaigns.metadata.collaboration_opportunity sin asumir su forma.
 * Sin plans[] (o vacío) → modo legacy: la campaña se comporta como hoy.
 * Planes guardados con forma inválida se descartan en la lectura (nunca se
 * inventan valores); el guardado siempre pasa por normalizePlans.
 */
export function readOpportunity(campaignMetadata: unknown): OpportunityView | null {
  const config = asRecord(asRecord(campaignMetadata).collaboration_opportunity)
  if (!Object.keys(config).length) return null
  const enabled = bool(config.enabled)
  const deadline = typeof config.application_deadline === 'string' && config.application_deadline ? config.application_deadline : null
  const storedPlans = Array.isArray(config.plans) ? config.plans.filter(isStoredPlan) : []
  if (storedPlans.length > 0) return { mode: 'plans', enabled, application_deadline: deadline, plans: sortPlans(storedPlans) }
  const currency = config.currency === 'USD' ? 'USD' : 'CLP'
  return {
    mode: 'legacy', enabled, application_deadline: deadline,
    benefits: text(config.benefits), participation_value: Math.max(0, numberOrNull(config.participation_value) ?? 0),
    currency, seats: Math.max(0, Math.trunc(numberOrNull(config.seats) ?? 0)),
  }
}

function isStoredPlan(value: unknown): value is BrandPlan {
  const plan = asRecord(value)
  return typeof plan.id === 'string' && typeof plan.name === 'string' && plan.name.trim() !== ''
    && typeof plan.price === 'number' && plan.price > 0
    && PLAN_CURRENCIES.includes(plan.currency as PlanCurrency)
    && Array.isArray(plan.benefits)
    && !!plan.payment_terms && typeof plan.payment_terms === 'object'
}

// ── DTO público y snapshot ───────────────────────────────────────────────────
export function toPublicPlan(plan: BrandPlan): PublicBrandPlan {
  // Lista explícita de campos: un campo interno nuevo nunca se filtra por omisión.
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    active: plan.active,
    display_order: plan.display_order,
    benefits: [...plan.benefits],
    influencer_minimum: plan.influencer_minimum,
    influencer_minimum_label: plan.influencer_minimum_label,
    stand_included: plan.stand_included,
    brand_brief_included: plan.brand_brief_included,
    influencer_content_included: plan.influencer_content_included,
    collaboration_included: plan.collaboration_included,
    additional_terms: plan.additional_terms,
    payment_terms: { ...plan.payment_terms },
  }
}

/** Planes que una marca puede ver: solo activos, ordenados, sin campos internos. */
export function listPublicPlans(plans: BrandPlan[]): PublicBrandPlan[] {
  return sortPlans(plans.filter(plan => plan.active)).map(toPublicPlan)
}

/** Copia profunda e independiente del plan: cambios posteriores al plan no la afectan. */
export function toPlanSnapshot(plan: BrandPlan, now: Date = new Date()): BrandPlanSnapshot {
  return JSON.parse(JSON.stringify({ ...toPublicPlan(plan), snapshot_at: now.toISOString() })) as BrandPlanSnapshot
}

// ── Montos ───────────────────────────────────────────────────────────────────
/** Divide el total según el primer porcentaje; la segunda cuota absorbe el redondeo (suma exacta). */
export function splitPlanAmount(total: number, firstPercentage: number): { first: number; second: number } {
  const first = Math.round((total * firstPercentage) / 100)
  return { first, second: total - first }
}

export function formatPlanMoney(amount: number, currency: PlanCurrency): string {
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

// ── Textos protectores (propuesta y contrato) ────────────────────────────────
export const COMMERCIAL_MODEL = 'brand_activation_plan' as const

export const ACTIVATION_DYNAMICS_CLAUSE =
  'El plan contratado corresponde a un plan de activación de marca dentro de un evento en el que participan múltiples marcas y múltiples influencers. ' +
  'Las influencers participantes reciben los briefs correspondientes a las marcas activadas y generan contenido durante el evento de acuerdo con la dinámica de activación definida por SCENCE.'

export const NO_GUARANTEED_PUBLICATIONS_CLAUSE =
  'La participación de influencers indicada en el plan se refiere a su participación en la dinámica del evento y no equivale a una cantidad de publicaciones garantizadas para la marca. ' +
  'SCENCE no garantiza un número determinado de publicaciones, piezas de contenido, alcances ni resultados.'

export const NON_EXCLUSIVITY_CLAUSE =
  'La participación de una influencer en la activación no implica exclusividad respecto de la marca, salvo acuerdo escrito específico entre las partes.'

export function collaborationClause(included: boolean, account: string | null): string {
  if (!included) return 'El plan no incluye la gestión de solicitudes de colaboración (Collab).'
  if (!account) throw new Error('El plan incluye Collab: falta confirmar la cuenta de colaboración')
  return `SCENCE gestionará la solicitud de colaboración (Collab) con la cuenta ${account}. ` +
    'La marca podrá aceptar o no dichas solicitudes; SCENCE gestiona la solicitud y no garantiza su aceptación por la marca ni por terceros.'
}

/** Líneas de alcance incluido/no incluido a partir de las banderas del plan + beneficios libres. */
export function planScopeLines(plan: PublicBrandPlan, collaborationAccount: string | null): { included: string[]; excluded: string[] } {
  const included: string[] = []
  const excluded: string[] = []
  const flag = (on: boolean, yes: string, no: string) => (on ? included : excluded).push(on ? yes : no)
  flag(plan.stand_included, 'Stand de marca en el evento', 'Stand de marca')
  if (plan.influencer_minimum_label) {
    included.push(`Participación de la marca dentro de la dinámica del evento junto a ${plan.influencer_minimum_label} influencers`)
  }
  flag(plan.brand_brief_included, 'Brief de marca, comunicado a las influencers participantes de la activación', 'Brief de marca')
  flag(plan.influencer_content_included, 'Contenido realizado por las influencers participantes durante el evento, dentro de la dinámica de activación', 'Contenido de influencers durante el evento')
  flag(plan.collaboration_included, `Gestión de la solicitud de colaboración (Collab) con la cuenta ${collaborationAccount ?? '[cuenta por confirmar]'}`, 'Gestión de solicitudes de colaboración (Collab)')
  for (const benefit of plan.benefits) if (!included.includes(benefit)) included.push(benefit)
  return { included, excluded }
}

export type PlanAnnexInput = {
  plan: PublicBrandPlan
  collaborationAccount: string | null
  brandName: string
  campaignName: string
  event?: { name?: string; date?: string; startTime?: string; location?: string }
}

export const PLAN_ANNEX_VERSION = 'plan-annex-v1'
export const PLAN_ANNEX_TOKEN = '{{plan_annex}}'

/**
 * ANEXO I del contrato de plan. Se genera en código desde el snapshot para que
 * la protección legal no dependa de una plantilla en DB. Lanza si el plan
 * incluye Collab y no hay cuenta confirmada.
 */
export function renderPlanAnnex(input: PlanAnnexInput): string {
  const { plan, collaborationAccount, brandName, campaignName, event } = input
  const scope = planScopeLines(plan, collaborationAccount)
  const { first, second } = splitPlanAmount(plan.price, plan.payment_terms.first_percentage)
  const eventLine = event && (event.name || event.date || event.location)
    ? [event.name, event.date, event.startTime, event.location].filter(Boolean).join(' · ')
    : null
  const bullets = (items: string[]) => items.map(item => `- ${item}`).join('\n')

  const sections = [
    'ANEXO I — PLAN DE ACTIVACIÓN DE MARCA CONTRATADO',
    `Marca: ${brandName}\nCampaña: ${campaignName}${eventLine ? `\nEvento: ${eventLine}` : ''}`,
    `1. Plan contratado\n${plan.name}${plan.description ? ` — ${plan.description}` : ''}\nMonto total: ${formatPlanMoney(plan.price, plan.currency)} (${plan.currency})`,
    `2. Alcance incluido\n${bullets(scope.included)}`,
    scope.excluded.length ? `3. No incluido en este plan\n${bullets(scope.excluded)}` : '3. No incluido en este plan\n- Cualquier prestación no descrita expresamente en la sección 2.',
    `4. Naturaleza del plan\n${ACTIVATION_DYNAMICS_CLAUSE}`,
    `5. Publicaciones y resultados\n${NO_GUARANTEED_PUBLICATIONS_CLAUSE}`,
    `6. No exclusividad\n${NON_EXCLUSIVITY_CLAUSE}`,
    `7. Colaboración (Collab)\n${collaborationClause(plan.collaboration_included, collaborationAccount)}`,
    `8. Condiciones de pago\n` +
      `- ${plan.payment_terms.first_percentage}% (${formatPlanMoney(first, plan.currency)}) ${PLAN_PAYMENT_CONDITIONS[plan.payment_terms.first_condition]}.\n` +
      `- ${plan.payment_terms.second_percentage}% (${formatPlanMoney(second, plan.currency)}) ${PLAN_PAYMENT_CONDITIONS[plan.payment_terms.second_condition]}.`,
  ]
  if (plan.additional_terms) sections.push(`9. Condiciones adicionales\n${plan.additional_terms}`)
  return sections.join('\n\n')
}

/**
 * Inserta el anexo en {{plan_annex}} si el texto lo trae (una sola vez; otras
 * apariciones se eliminan); si no, lo agrega al final. Debe aplicarse sobre la
 * plantilla ANTES de renderDocument(), que reemplaza variables desconocidas
 * por "________________".
 */
export function appendPlanAnnex(renderedContract: string, annex: string): string {
  if (renderedContract.includes(PLAN_ANNEX_TOKEN)) {
    const [head, ...rest] = renderedContract.split(PLAN_ANNEX_TOKEN)
    return `${head}${annex}${rest.join('')}`
  }
  return `${renderedContract.trimEnd()}\n\n${annex}\n`
}
