// Lista blanca de escritura de /api/influencers/[id] (PUT/PATCH) — solo admin
// de plataforma. Antes el body completo (`...rest`) llegaba al UPDATE: user_id,
// organization_id y metadata (manual_pro) eran escribibles. La influencer edita
// su ficha por /api/influencer/me, que tiene su propia lista blanca.

export const ADMIN_INFLUENCER_COLUMNS = [
  'display_name', 'bio', 'avatar_url', 'cover_url', 'email', 'phone', 'whatsapp',
  'address', 'location_id', 'birth_date', 'categories', 'tags', 'timezone',
  'language', 'gender', 'age_range', 'is_verified', 'is_active', 'rating', 'notes',
] as const

// Claves que viven en metadata (se mezclan con lo existente, nunca lo reemplazan).
// `manual_pro` NO está: solo se cambia por /api/influencers/[id]/pro.
export const INFLUENCER_META_KEYS = ['first_name', 'last_name', 'deactivation_reason', 'status'] as const
export const INFLUENCER_META_STATUSES = ['draft', 'active', 'inactive'] as const

export function pickAdminInfluencerColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ADMIN_INFLUENCER_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key]
  }
  return out
}

export function pickInfluencerMetaPatch(
  source: Record<string, unknown>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {}
  for (const key of INFLUENCER_META_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === undefined) continue
    const v = source[key]
    if (key === 'status') {
      if (!(INFLUENCER_META_STATUSES as readonly unknown[]).includes(v)) return { ok: false, error: 'Estado no válido' }
    } else if (v !== null && (typeof v !== 'string' || v.length > 500)) {
      return { ok: false, error: `El campo ${key} no es válido` }
    }
    patch[key] = v
  }
  return { ok: true, patch }
}

export type SafeRateCard = { deliverable_type: string; base_rate: number; currency?: string; notes?: string | null }

// Tarifas: solo estas columnas, tipadas. El form envía service_type → deliverable_type.
export function sanitizeRateCards(input: unknown): { ok: true; rows: SafeRateCard[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Tarifas no válidas' }
  const rows: SafeRateCard[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Tarifa no válida' }
    const rc = raw as Record<string, unknown>
    const type = (rc.service_type ?? rc.deliverable_type)
    if (typeof type !== 'string' || !type.trim() || type.length > 100) return { ok: false, error: 'Tipo de tarifa no válido' }
    const rate = Number(rc.base_rate)
    if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: 'El valor de la tarifa debe ser un número mayor o igual a 0' }
    const row: SafeRateCard = { deliverable_type: type.trim(), base_rate: rate }
    if (rc.currency !== undefined && rc.currency !== null) {
      if (typeof rc.currency !== 'string' || rc.currency.length > 8) return { ok: false, error: 'Moneda no válida' }
      row.currency = rc.currency
    }
    if (rc.notes !== undefined) {
      if (rc.notes !== null && (typeof rc.notes !== 'string' || rc.notes.length > 500)) return { ok: false, error: 'Nota de tarifa no válida' }
      row.notes = rc.notes
    }
    rows.push(row)
  }
  return { ok: true, rows }
}
