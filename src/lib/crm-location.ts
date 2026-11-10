import type { createAdminClient } from '@/lib/supabase/server'

// Normaliza país / región / comuna de un lead contra `locations` (fuente única de
// geografía). Lo que NO existe en el catálogo no se guarda en esos campos: se mueve a
// `address` (si estaba vacía) para no perder el dato ni crear ubicaciones paralelas.
type Admin = ReturnType<typeof createAdminClient>

const keyOf = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Códigos administrativos de las regiones de Chile (1–16).
const CL_REGION_CODES: Record<string, string> = {
  '1': 'Tarapacá', '2': 'Antofagasta', '3': 'Atacama', '4': 'Coquimbo', '5': 'Valparaíso',
  '6': "O'Higgins", '7': 'Maule', '8': 'Biobío', '9': 'La Araucanía', '10': 'Los Lagos',
  '11': 'Aysén', '12': 'Magallanes', '13': 'Región Metropolitana', '14': 'Los Ríos',
  '15': 'Arica y Parinacota', '16': 'Ñuble',
}
const REGION_ALIASES: Record<string, string> = {
  rm: 'Región Metropolitana', metropolitana: 'Región Metropolitana', santiago: 'Región Metropolitana',
  regionmetropolitanadesantiago: 'Región Metropolitana', ohiggins: "O'Higgins",
  libertadorgeneralbernardoohiggins: "O'Higgins", araucania: 'La Araucanía',
  aisen: 'Aysén', magallanesydelaantarticachilena: 'Magallanes', bobio: 'Biobío',
}
const COUNTRY_ALIASES: Record<string, string> = { usa: 'Estados Unidos', eeuu: 'Estados Unidos', unitedstates: 'Estados Unidos', uk: 'Reino Unido', mexico: 'México' }

const TTL_MS = 10 * 60_000
type Cat = { country: Map<string, string>; region: Map<string, string>; commune: Map<string, string> }
let cache: { at: number; cat: Cat } | null = null

async function catalog(admin: Admin): Promise<Cat> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cat
  const cat: Cat = { country: new Map(), region: new Map(), commune: new Map() }
  const { data, error } = await admin.from('locations').select('name, level').in('level', ['country', 'region', 'commune']).eq('is_active', true)
  if (error) throw new Error(error.message)
  for (const r of data ?? []) {
    const m = cat[r.level as keyof Cat]
    if (m && !m.has(keyOf(r.name))) m.set(keyOf(r.name), r.name)
  }
  cache = { at: Date.now(), cat }
  return cat
}

export type LeadLocation = { country?: string | null; region?: string | null; commune?: string | null; address?: string | null }

export async function normalizeLeadLocation(admin: Admin, input: LeadLocation): Promise<LeadLocation> {
  const clean = (v?: string | null) => (v ?? '').trim()
  let country = clean(input.country), region = clean(input.region), commune = clean(input.commune)
  let address = clean(input.address)
  try {
    const cat = await catalog(admin)
    if (country) {
      const k = keyOf(country)
      country = cat.country.get(k) ?? COUNTRY_ALIASES[k] ?? ''
    }
    const leftovers: string[] = []
    if (commune) {
      const c = cat.commune.get(keyOf(commune))
      if (c) commune = c; else { leftovers.push(commune); commune = '' }
    }
    if (region) {
      const k = keyOf(region)
      const r = cat.region.get(k) ?? (CL_REGION_CODES[region] ?? REGION_ALIASES[k])
      if (r) {
        region = r
        // Región chilena catalogada (códigos 1–16 o nombre) ⇒ el país es Chile.
        if (!country && Object.values(CL_REGION_CODES).includes(r)) country = 'Chile'
      } else { leftovers.push(region); region = '' }
    }
    if (!address && leftovers.length) address = leftovers.join(', ')
  } catch (error) {
    console.error('[normalizeLeadLocation]', error)
  }
  return { country: country || null, region: region || null, commune: commune || null, address: address || null }
}

// Dominios personales/ISP: NO son la web de una empresa.
const PERSONAL = new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.cl','hotmail.es','outlook.com','outlook.es','live.com','live.cl','msn.com','yahoo.com','yahoo.es','yahoo.cl','yahoo.com.ar','icloud.com','me.com','mac.com','aol.com','mail.com','vtr.net','terra.cl','entelchile.net','sbcglobal.net','att.net','verizon.net','comcast.net','protonmail.com','gmx.com'])

/**
 * Web desde el correo SOLO si el dominio coincide con el nombre de la empresa (el
 * nombre del dominio, ≥4 letras, está contenido en el de la empresa). Sin empresa o
 * sin coincidencia ⇒ null: nunca se asigna la web de un banco, universidad o proveedor
 * de correo a un contacto personal.
 */
export function websiteFromEmail(email: string | null | undefined, companyName: string | null | undefined): string | null {
  const d = (email ?? '').split('@')[1]?.trim().toLowerCase()
  if (!d || !d.includes('.') || PERSONAL.has(d) || !companyName) return null
  const flat = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const label = flat(d.split('.')[0])
  return label.length >= 4 && flat(companyName).includes(label) ? `https://${d}` : null
}
