import type { createAdminClient } from '@/lib/supabase/server'

// Estandariza la comuna de un lead al nombre oficial de `locations` (fuente única de
// geografía). Mayúsculas, tildes y espacios no importan ("LAS CONDES", "las condes" →
// "Las Condes"); unas pocas abreviaturas conocidas se resuelven por alias. Lo que no
// se reconoce se conserva tal cual: nunca se pierde el dato que escribió la persona.
type Admin = ReturnType<typeof createAdminClient>

const keyOf = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const ALIASES: Record<string, string> = {
  estcentral: 'Estación Central',
  estaccentral: 'Estación Central',
  paguirrecerda: 'Pedro Aguirre Cerda',
  santiagocentro: 'Santiago',
  santiagodechile: 'Santiago',
  stgo: 'Santiago',
  sanjosemaipo: 'San José de Maipo',
  quintano13al: 'Quinta Normal',
  calera: 'La Calera',
}

const TTL_MS = 10 * 60_000
let cache: { at: number; byKey: Map<string, string> } | null = null

async function communeCatalog(admin: Admin) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byKey
  const { data, error } = await admin.from('locations').select('name').eq('level', 'commune').eq('is_active', true)
  if (error) throw new Error(error.message)
  const byKey = new Map<string, string>()
  for (const row of data ?? []) if (!byKey.has(keyOf(row.name))) byKey.set(keyOf(row.name), row.name)
  cache = { at: Date.now(), byKey }
  return byKey
}

export async function canonicalCommune(admin: Admin, value: string | null | undefined): Promise<string | null> {
  const raw = (value ?? '').trim()
  if (!raw) return null
  try {
    const byKey = await communeCatalog(admin)
    const key = keyOf(raw)
    return byKey.get(key) ?? ALIASES[key] ?? raw
  } catch (error) {
    console.error('[canonicalCommune]', error)
    return raw
  }
}
