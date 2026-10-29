// Dirección estructurada de la influencer. La ubicación geográfica (país/región/comuna)
// vive SOLO en influencers.location_id → locations; aquí solo van calle, depto y código postal.
export type AddressParts = { street: string; unit: string; postal_code: string }

export const EMPTY_ADDRESS_PARTS: AddressParts = { street: '', unit: '', postal_code: '' }

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function sanitizeAddressParts(value: unknown): AddressParts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  return {
    street: clean(v.street, 160),
    unit: clean(v.unit, 80),
    postal_code: clean(v.postal_code, 12).replace(/[^\w\s-]/g, ''),
  }
}

/** Texto para influencers.address (lo leen contratos, envíos y exportaciones). */
export function composeAddress(parts: AddressParts): string {
  return [parts.street, parts.unit, parts.postal_code ? `CP ${parts.postal_code}` : ''].map(p => p.trim()).filter(Boolean).join(', ')
}

/** Partes para el formulario: usa las guardadas; si no hay, la dirección anterior entera va en "calle" (no se pierde). */
export function partsFromProfile(address: string | null | undefined, saved: unknown): AddressParts {
  return sanitizeAddressParts(saved) ?? { ...EMPTY_ADDRESS_PARTS, street: (address ?? '').trim() }
}
