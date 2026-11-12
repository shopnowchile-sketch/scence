// Actualización PARCIAL del perfil de marca (PATCH /api/brand/me).
//
// Antes la ruta escribía todos los campos con `|| null`: un formulario que solo enviaba la dirección
// (BrandAddressForm) dejaba en null contacto, web, industria, RUT y coordenadas. Ahora solo se escribe lo que
// viene en el cuerpo; lo que no se envía no se toca. Módulo puro (sin servidor) para poder probarlo.

const TEXT_FIELDS = [
  'website', 'instagram', 'industry', 'rut',
  'contact_name', 'contact_email', 'contact_phone',
  'address_street', 'address_number', 'address_city', 'address_region', 'address_country', 'address_place_id',
  'address2_street', 'address2_number', 'address2_city', 'address2_region', 'address2_country',
] as const

const NUMBER_FIELDS = ['address_lat', 'address_lng'] as const

export function buildBrandProfileUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if ('name' in body && typeof body.name === 'string' && body.name.trim()) update.name = body.name
  for (const key of TEXT_FIELDS) {
    if (key in body) update[key] = body[key] || null
  }
  for (const key of NUMBER_FIELDS) {
    if (key in body) update[key] = body[key] ?? null
  }
  return update
}

/** Estado final de los campos que validan las reglas legales: lo guardado + lo que llega en este PATCH. */
export function mergeLegalState<T extends Record<string, unknown>>(existing: T | null, update: Record<string, unknown>): Record<string, unknown> {
  return { ...(existing ?? {}), ...update }
}
