// Reglas del servidor para las campañas que crea una influencer para sí misma
// (POST/PATCH /api/influencer/my-campaigns). Funciones puras: sin base de datos.
//
// Por qué existe (auditoría 2026-10-19, G-11 pendiente de decisión de producto):
//  - `brand_id` NO lo decide la influencer: una campaña propia no pertenece a
//    ninguna marca. Aceptarlo permitía colgar una campaña de una marca ajena
//    (la lista de la marca filtra por brand_id) y leer sus datos de contacto.
//  - `status` solo admite cierres/pausas. Activar, volver a borrador o pasar a
//    revisión corresponde a la agencia (admin).

export const SELF_CAMPAIGN_ALLOWED_STATUSES = ['paused', 'completed', 'canceled'] as const

export const SELF_CAMPAIGN_NAME_MAX = 120
export const SELF_CAMPAIGN_DESCRIPTION_MAX = 5000

export type SelfCampaignResult<T> = { ok: true; value: T } | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY_RE = /^[A-Z]{3}$/

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** '' / null / undefined → null. Texto inválido → undefined (error). */
function parseDate(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !isRealDate(v)) return undefined
  return v
}

function parseName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const name = v.trim()
  if (!name || name.length > SELF_CAMPAIGN_NAME_MAX) return undefined
  return name
}

function parseDescription(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.length > SELF_CAMPAIGN_DESCRIPTION_MAX) return undefined
  return v
}

function parseCurrency(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const c = v.trim().toUpperCase()
  return CURRENCY_RE.test(c) ? c : undefined
}

function datesInOrder(start: string | null, end: string | null): boolean {
  return !(start && end && end < start)
}

export type SelfCampaignCreate = {
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
  currency: string
  fee: number | null
}

/** Valida el body del POST. `brand_id` y `status` del body se ignoran siempre. */
export function validateSelfCampaignCreate(body: unknown): SelfCampaignResult<SelfCampaignCreate> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const name = parseName(b.name)
  if (name === undefined) {
    return { ok: false, error: `name requerido (máximo ${SELF_CAMPAIGN_NAME_MAX} caracteres)` }
  }
  const start_date = parseDate(b.start_date)
  if (start_date === undefined) return { ok: false, error: 'start_date inválida (use AAAA-MM-DD)' }
  const end_date = parseDate(b.end_date)
  if (end_date === undefined) return { ok: false, error: 'end_date inválida (use AAAA-MM-DD)' }
  if (!datesInOrder(start_date, end_date)) {
    return { ok: false, error: 'La fecha fin no puede ser anterior a la fecha inicio' }
  }
  const description = parseDescription(b.description)
  if (description === undefined) {
    return { ok: false, error: `description inválida (máximo ${SELF_CAMPAIGN_DESCRIPTION_MAX} caracteres)` }
  }
  const currency = b.currency === undefined || b.currency === null ? 'CLP' : parseCurrency(b.currency)
  if (currency === undefined) return { ok: false, error: 'currency inválida (código de 3 letras)' }

  let fee: number | null = null
  if (b.fee !== undefined && b.fee !== null && b.fee !== '') {
    if (typeof b.fee !== 'number' || !Number.isFinite(b.fee) || b.fee < 0) {
      return { ok: false, error: 'fee inválido' }
    }
    fee = b.fee
  }

  return { ok: true, value: { name, description, start_date, end_date, currency, fee } }
}

/**
 * Construye el UPDATE permitido para el PATCH. Solo name, description, fechas,
 * currency y status (cierres). `brand_id` y cualquier otro campo se ignoran.
 * `existing` permite validar el orden de fechas cuando solo llega una.
 */
export function buildSelfCampaignUpdate(
  updates: Record<string, unknown>,
  existing: { start_date: string | null; end_date: string | null } = { start_date: null, end_date: null },
): SelfCampaignResult<Record<string, unknown>> {
  const out: Record<string, unknown> = {}

  if ('name' in updates) {
    const name = parseName(updates.name)
    if (name === undefined) {
      return { ok: false, error: `name inválido (1 a ${SELF_CAMPAIGN_NAME_MAX} caracteres)` }
    }
    out.name = name
  }
  if ('description' in updates) {
    const description = parseDescription(updates.description)
    if (description === undefined) return { ok: false, error: 'description inválida' }
    out.description = description
  }
  if ('start_date' in updates) {
    const d = parseDate(updates.start_date)
    if (d === undefined) return { ok: false, error: 'start_date inválida (use AAAA-MM-DD)' }
    out.start_date = d
  }
  if ('end_date' in updates) {
    const d = parseDate(updates.end_date)
    if (d === undefined) return { ok: false, error: 'end_date inválida (use AAAA-MM-DD)' }
    out.end_date = d
  }
  if ('currency' in updates) {
    const c = parseCurrency(updates.currency)
    if (c === undefined) return { ok: false, error: 'currency inválida (código de 3 letras)' }
    out.currency = c
  }
  if ('status' in updates) {
    const s = updates.status
    if (typeof s !== 'string' || !(SELF_CAMPAIGN_ALLOWED_STATUSES as readonly string[]).includes(s)) {
      return { ok: false, error: `status no permitido (use: ${SELF_CAMPAIGN_ALLOWED_STATUSES.join(', ')})` }
    }
    out.status = s
  }

  const start = ('start_date' in out ? out.start_date : existing.start_date) as string | null
  const end = ('end_date' in out ? out.end_date : existing.end_date) as string | null
  if (!datesInOrder(start, end)) {
    return { ok: false, error: 'La fecha fin no puede ser anterior a la fecha inicio' }
  }

  return { ok: true, value: out }
}
