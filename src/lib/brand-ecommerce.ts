// Canales e-commerce de una marca: enlaces (no son lugares físicos, no tienen geografía).
// Viven en brands.metadata.ecommerce_links; los puntos de venta físicos son locations (type='store').
export type EcommerceLink = { name: string; url: string }

export const ECOMMERCE_MAX_LINKS = 10

export function validateEcommerceLinks(input: unknown): { ok: true; value: EcommerceLink[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Lista de e-commerce inválida' }
  if (input.length > ECOMMERCE_MAX_LINKS) return { ok: false, error: `Máximo ${ECOMMERCE_MAX_LINKS} enlaces` }
  const value: EcommerceLink[] = []
  for (const raw of input) {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!name || name.length > 80) return { ok: false, error: 'Cada e-commerce necesita un nombre (máx. 80 caracteres)' }
    if (!url || url.length > 300) return { ok: false, error: 'Cada e-commerce necesita una URL (máx. 300 caracteres)' }
    let parsed: URL
    try { parsed = new URL(url) } catch { return { ok: false, error: `URL inválida: ${url}` } }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, error: 'La URL debe empezar con http:// o https://' }
    value.push({ name, url: parsed.toString() })
  }
  return { ok: true, value }
}

export function readEcommerceLinks(metadata: unknown): EcommerceLink[] {
  const links = (metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).ecommerce_links : null)
  const res = validateEcommerceLinks(Array.isArray(links) ? links : [])
  return res.ok ? res.value : []
}
