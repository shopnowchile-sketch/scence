// Locations — constantes compartidas por API y UI.
// La validación real de la jerarquía vive en la base
// (trigger locations_validate_hierarchy); esto solo guía la UI y los mensajes.

export const LOCATION_LEVELS = ['country', 'region', 'city', 'commune', 'place'] as const
export type LocationLevel = (typeof LOCATION_LEVELS)[number]

export const LEVEL_LABELS: Record<LocationLevel, string> = {
  country: 'País',
  region:  'Región',
  city:    'Ciudad',
  commune: 'Comuna',
  place:   'Lugar',
}

/** Hijos permitidos por nivel. city es opcional: una región acepta ciudades o comunas. */
export const CHILD_LEVELS: Record<LocationLevel | 'root', LocationLevel[]> = {
  root:    ['country'],
  country: ['region'],
  region:  ['commune', 'city'],
  city:    ['commune'],
  commune: ['place'],
  place:   [],
}

/** Categorías de place — deben coincidir con locations_type_check en la base. */
export const PLACE_TYPES = ['brand_venue', 'store', 'showroom', 'event', 'influencer_home', 'other'] as const
export type PlaceType = (typeof PLACE_TYPES)[number]

export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  brand_venue:     'Local de marca',
  store:           'Tienda',
  showroom:        'Showroom',
  event:           'Lugar de evento',
  influencer_home: 'Domicilio de influencer',
  other:           'Otro',
}

export type BreadcrumbItem = { id: string; name: string; level: LocationLevel }

export type LocationRow = {
  id: string
  parent_id: string | null
  level: LocationLevel
  type: PlaceType | null
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  is_private: boolean
  is_active: boolean
  brand_id: string | null
  owner_influencer_id: string | null
  notes: string | null
  children_count?: number
}

/** Columnas que expone la API (sin organization_id / created_by). */
export const LOCATION_COLUMNS =
  'id, parent_id, level, type, name, address, lat, lng, is_private, is_active, brand_id, owner_influencer_id, notes'

/** Traduce errores de Postgres (trigger / constraints) a respuestas claras. */
export function locationDbError(error: { code?: string; message: string }): { status: number; error: string } {
  switch (error.code) {
    case '22P02': // invalid_text_representation (uuid mal formado)
      return { status: 400, error: 'Identificador inválido.' }
    case '23514': // check_violation (trigger y CHECKs)
      if (error.message.includes('locations_place_fields_check'))
        return { status: 422, error: 'Solo los lugares (place) pueden tener dirección, coordenadas, tipo, dueño o privacidad.' }
      if (error.message.includes('locations_coords_check'))
        return { status: 422, error: 'Latitud o longitud fuera de rango.' }
      return { status: 422, error: error.message }
    case '23505': // unique_violation
      return { status: 409, error: error.message.includes('locations_geo_unique_name') ? 'Ya existe una ubicación con ese nombre en este nivel.' : error.message }
    case '23503': // foreign_key_violation
      return { status: 422, error: error.message.includes('locations_parent_id_fkey') ? 'Tiene ubicaciones hijas: desactívala en vez de borrarla.' : 'Referencia inválida (padre, marca o influencer).' }
    default:
      return { status: 500, error: error.message }
  }
}

/** lat/lng opcionales: vacío → null; no numérico → 'invalid' (422). El rango lo valida la base. */
export function toCoord(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : 'invalid'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
