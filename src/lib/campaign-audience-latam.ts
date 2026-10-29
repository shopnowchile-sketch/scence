/** Países de LATAM del catálogo `locations`. "LATAM" no es un nodo: se expande a estos países. */
export const LATAM_COUNTRY_NAMES = [
  'Argentina', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Costa Rica', 'Cuba', 'Ecuador',
  'El Salvador', 'Guatemala', 'Honduras', 'México', 'Nicaragua', 'Panamá', 'Paraguay',
  'Perú', 'República Dominicana', 'Uruguay', 'Venezuela',
] as const

const norm = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const LATAM_NORMALIZED = new Set<string>(LATAM_COUNTRY_NAMES.map(norm))

export const isLatamCountryName = (name: string) => LATAM_NORMALIZED.has(norm(name))

export function latamCountryIds(nodes: Array<{ id: string; level: string; name: string; is_active?: boolean }>): string[] {
  return nodes.filter(n => n.is_active !== false && n.level === 'country' && isLatamCountryName(n.name)).map(n => n.id)
}
