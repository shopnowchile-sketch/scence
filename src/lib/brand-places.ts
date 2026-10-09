// Lugares (locations.level = 'place') que administra cada marca. Reglas puras:
// el servidor fuerza brand_id / organization_id, nunca los lee del body.
import { PLACE_TYPES, isUuid, type PlaceType } from './locations'

/** Una marca nunca crea domicilios de influencer (esos son privados y de la influencer). */
export const BRAND_PLACE_TYPES = PLACE_TYPES.filter(t => t !== 'influencer_home') as PlaceType[]

export const BRAND_PLACE_NAME_MAX = 120
export const BRAND_PLACE_ADDRESS_MAX = 200

/** Comparación sin tildes ni mayúsculas (equivalente a locations_norm). */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function matchesPlaceQuery(place: { name: string; address?: string | null }, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true
  return normalizeText(place.name).includes(q) || normalizeText(place.address ?? '').includes(q)
}

type Valid<T> = { ok: true; value: T } | { ok: false; error: string }

export type BrandPlaceInput = { name: string; address: string; parent_id: string; type: PlaceType; notes: string | null }

function text(value: unknown, max: number, label: string, required: boolean): Valid<string | null> {
  if (value === undefined || value === null || value === '') {
    return required ? { ok: false, error: `${label} es obligatorio` } : { ok: true, value: null }
  }
  if (typeof value !== 'string') return { ok: false, error: `${label} inválido` }
  const trimmed = value.trim()
  if (!trimmed) return required ? { ok: false, error: `${label} es obligatorio` } : { ok: true, value: null }
  if (trimmed.length > max) return { ok: false, error: `${label} no puede superar ${max} caracteres` }
  return { ok: true, value: trimmed }
}

export function validateBrandPlaceCreate(body: unknown): Valid<BrandPlaceInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = text(b.name, BRAND_PLACE_NAME_MAX, 'El nombre', true)
  if (!name.ok) return name
  const address = text(b.address, BRAND_PLACE_ADDRESS_MAX, 'La dirección', true)
  if (!address.ok) return address
  const notes = text(b.notes, 500, 'Las notas', false)
  if (!notes.ok) return notes
  if (typeof b.parent_id !== 'string' || !isUuid(b.parent_id)) return { ok: false, error: 'Selecciona la comuna del lugar' }
  const type = (b.type ?? 'brand_venue') as PlaceType
  if (!BRAND_PLACE_TYPES.includes(type)) return { ok: false, error: 'Tipo de lugar inválido' }
  return { ok: true, value: { name: name.value as string, address: address.value as string, parent_id: b.parent_id, type, notes: notes.value } }
}

/** PATCH: solo estos campos; padre, marca y organización no se mueven desde el cliente. */
export function validateBrandPlacePatch(body: unknown): Valid<Partial<Omit<BrandPlaceInput, 'parent_id'>>> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const out: Partial<Omit<BrandPlaceInput, 'parent_id'>> = {}
  if ('name' in b) {
    const r = text(b.name, BRAND_PLACE_NAME_MAX, 'El nombre', true); if (!r.ok) return r
    out.name = r.value as string
  }
  if ('address' in b) {
    const r = text(b.address, BRAND_PLACE_ADDRESS_MAX, 'La dirección', true); if (!r.ok) return r
    out.address = r.value as string
  }
  if ('notes' in b) {
    const r = text(b.notes, 500, 'Las notas', false); if (!r.ok) return r
    out.notes = r.value
  }
  if ('type' in b) {
    if (!BRAND_PLACE_TYPES.includes(b.type as PlaceType)) return { ok: false, error: 'Tipo de lugar inválido' }
    out.type = b.type as PlaceType
  }
  if (!Object.keys(out).length) return { ok: false, error: 'Nada que actualizar' }
  return { ok: true, value: out }
}
