import type { SupabaseClient } from '@supabase/supabase-js'

export interface ScanInfluencer {
  id: string
  display_name: string | null
  email: string | null
  is_active: boolean
  created_at: string | null
  instagram_url: string | null
  instagram_username: string | null
  followers: number
  commune: string | null
  address: string | null
  categories: string[] | null
}

// Ranking por comuna / nicho (pedido Pri 2026-07-13): value=null representa
// "Sin comuna" / "Sin nicho" — se incluye como una fila más del ranking (no
// aparte), así el orden de mayor a menor queda consistente entre ambos casos.
export interface RankingItem {
  value: string | null
  label: string
  count: number
}

// FIX (2026-07-13, pedido Pri): antes 'instagram_url' e 'instagram' eran DOS
// criterios de duplicado separados que nunca se comparaban entre sí — un
// mismo perfil guardado como URL en una fila y como username en otra nunca
// se detectaba como duplicado. Ahora hay un solo tipo 'instagram' (ver
// extractInstagramHandle). 'mixed' = un grupo fusionado que comparte
// influencers detectados por más de un criterio (ver mergeOverlappingGroups).
export interface DuplicateGroup {
  key: string
  type: 'email' | 'instagram' | 'mixed'
  value: string
  influencers: ScanInfluencer[]
}

export interface DataQualityReport {
  total: number
  active: number
  inactive: number
  withoutInstagram: number
  withInstagram: number
  withoutCommune: number
  withoutAddress: number
  // Con Instagram Y comuna Y dirección — el resto le falta al menos uno de
  // los 3 datos obligatorios para usar el portal (ver ProfileCompletionGate).
  missingAnyRequired: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagram: number
  duplicatesByMixed: number
  communeRanking: RankingItem[]
  nicheRanking: RankingItem[]
}

function normUrl(url: string | null): string | null {
  if (!url) return null
  let u = url.trim().toLowerCase()
  if (!u) return null
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').replace(/\?.*$/, '')
  return u || null
}

function normHandle(h: string | null): string | null {
  if (!h) return null
  const v = h.trim().toLowerCase().replace(/^@/, '')
  return v || null
}

function normEmail(e: string | null): string | null {
  if (!e) return null
  const v = e.trim().toLowerCase()
  return v || null
}

// Unifica instagram_url e instagram_username en UN solo identificador
// normalizado (pedido Pri #1). Prioriza el username explícito; si no hay,
// extrae el primer segmento de path de la URL (con o sin dominio
// instagram.com), le quita @ / query string / slash final.
function extractInstagramHandle(url: string | null, username: string | null): string | null {
  const fromUsername = normHandle(username)
  if (fromUsername) return fromUsername
  if (!url) return null

  let u = url.trim().toLowerCase()
  if (!u) return null
  u = u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '')
  const domainMatch = u.match(/^(?:www\.)?instagram\.com\/([^/]+)/)
  const raw = domainMatch ? domainMatch[1] : u.replace(/^\/+/, '').split('/')[0]
  return normHandle(raw)
}

/** Carga todos los influencers de la org con su perfil de Instagram resuelto. */
export async function loadScan(admin: SupabaseClient, orgId: string): Promise<ScanInfluencer[]> {
  const PAGE = 1000
  let from = 0
  const all: ScanInfluencer[] = []
  const seenIds = new Set<string>()

  for (;;) {
    const { data, error } = await admin
      .from('influencers')
      .select(`
        id, display_name, email, is_active, created_at, commune, address, categories,
        social_profiles:influencer_social_profiles ( platform, profile_url, username, followers )
      `)
      .eq('organization_id', orgId)
      // Desempate estable por id: con imports masivos, cientos de filas
      // comparten el mismo created_at (una sola sentencia INSERT evalúa
      // now() una vez para todas sus filas). Ordenar solo por created_at
      // hace que la paginación por range() sea inestable con tantos
      // empates — la misma fila puede aparecer en dos páginas seguidas,
      // generando un "duplicado" fantasma (mismo id dos veces) que rompe
      // el merge (keepId y su único mergeId terminan siendo el mismo id).
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const inf of data) {
      if (seenIds.has(inf.id)) continue // red de seguridad extra contra el mismo id repetido
      seenIds.add(inf.id)
      const profiles = (inf.social_profiles ?? []) as Array<{
        platform: string; profile_url: string | null; username: string | null; followers: number | null
      }>
      const ig = profiles.find(p => p.platform === 'instagram')
      const totalFollowers = profiles.reduce((s, p) => s + (p.followers ?? 0), 0)
      all.push({
        id: inf.id,
        display_name: inf.display_name,
        email: inf.email,
        is_active: inf.is_active !== false,
        created_at: inf.created_at,
        instagram_url: ig?.profile_url ?? null,
        instagram_username: ig?.username ?? null,
        followers: totalFollowers,
        commune: (inf as { commune?: string | null }).commune ?? null,
        address: (inf as { address?: string | null }).address ?? null,
        categories: (inf as { categories?: string[] | null }).categories ?? null,
      })
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  return all
}

/**
 * Fusiona grupos de duplicados superpuestos (pedido Pri #2): si A coincide
 * con B por email y B con C por Instagram, el resultado es UN solo grupo
 * A+B+C, no dos grupos separados que comparten a B. Union-Find simple sobre
 * ids de influencer.
 */
function mergeOverlappingGroups(rawGroups: DuplicateGroup[]): DuplicateGroup[] {
  const parent = new Map<string, string>()

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const g of rawGroups) {
    const ids = g.influencers.map(i => i.id)
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i])
  }

  const byRoot = new Map<string, {
    influencersById: Map<string, ScanInfluencer>
    types: Set<DuplicateGroup['type']>
    values: Set<string>
  }>()

  for (const g of rawGroups) {
    const root = find(g.influencers[0].id)
    if (!byRoot.has(root)) byRoot.set(root, { influencersById: new Map(), types: new Set(), values: new Set() })
    const bucket = byRoot.get(root)!
    for (const inf of g.influencers) bucket.influencersById.set(inf.id, inf)
    bucket.types.add(g.type)
    bucket.values.add(g.value)
  }

  return Array.from(byRoot.entries()).map(([root, bucket]) => ({
    key: `merged:${root}`,
    type: bucket.types.size === 1 ? (Array.from(bucket.types)[0] as DuplicateGroup['type']) : 'mixed',
    value: Array.from(bucket.values).join(' + '),
    influencers: Array.from(bucket.influencersById.values()),
  }))
}

/**
 * Agrupa duplicados por email e Instagram (URL o username unificados en un
 * solo criterio — ver extractInstagramHandle), y fusiona grupos que
 * comparten algún influencer entre sí (ver mergeOverlappingGroups).
 */
export function findDuplicates(scan: ScanInfluencer[]): DuplicateGroup[] {
  const rawGroups: DuplicateGroup[] = []

  const buildFor = (
    type: DuplicateGroup['type'],
    keyFn: (i: ScanInfluencer) => string | null,
  ) => {
    const map = new Map<string, ScanInfluencer[]>()
    for (const inf of scan) {
      const k = keyFn(inf)
      if (!k) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(inf)
    }
    for (const [value, list] of Array.from(map.entries())) {
      if (list.length < 2) continue
      rawGroups.push({ key: `${type}:${value}`, type, value, influencers: list })
    }
  }

  buildFor('email', i => normEmail(i.email))
  buildFor('instagram', i => extractInstagramHandle(i.instagram_url, i.instagram_username))

  return mergeOverlappingGroups(rawGroups)
}

/**
 * Ranking genérico de mayor a menor por un campo con 0..N valores por
 * influencer (comuna = 1 valor, categorías/nicho = array). "Sin <label>" se
 * agrega como una fila más y entra en el mismo orden desc. Pri: "no contar
 * dos veces al mismo influencer" — se dedupean valores repetidos dentro del
 * mismo influencer antes de sumar (p.ej. la misma categoría dos veces en su
 * array), así cada influencer aporta como máximo 1 al conteo de un mismo valor.
 */
function buildRanking(
  scan: ScanInfluencer[],
  getValues: (i: ScanInfluencer) => (string | null)[],
  noneLabel: string,
): RankingItem[] {
  const counts = new Map<string, number>()
  let none = 0
  for (const inf of scan) {
    const values = Array.from(new Set(
      getValues(inf).map(v => v?.trim()).filter((v): v is string => Boolean(v))
    ))
    if (values.length === 0) { none++; continue }
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const items: RankingItem[] = Array.from(counts.entries()).map(([value, count]) => ({ value, label: value, count }))
  items.push({ value: null, label: noneLabel, count: none })
  return items.sort((a, b) => b.count - a.count)
}

export function buildReport(scan: ScanInfluencer[], groups: DuplicateGroup[]): DataQualityReport {
  const active = scan.filter(i => i.is_active).length
  const withInstagram = scan.filter(i => i.instagram_url || i.instagram_username).length
  const withoutCommune = scan.filter(i => !i.commune || !i.commune.trim()).length
  const withoutAddress = scan.filter(i => !i.address || !i.address.trim()).length
  const missingAnyRequired = scan.filter(i =>
    !(i.instagram_url || i.instagram_username) || !i.commune?.trim() || !i.address?.trim()
  ).length

  const dupRecordIds = new Set<string>()
  let byEmail = 0, byInstagram = 0, byMixed = 0
  for (const g of groups) {
    g.influencers.forEach(i => dupRecordIds.add(i.id))
    if (g.type === 'email') byEmail += g.influencers.length - 1
    else if (g.type === 'instagram') byInstagram += g.influencers.length - 1
    else byMixed += g.influencers.length - 1
  }

  const communeRanking = buildRanking(scan, i => [i.commune], 'Sin comuna')
  const nicheRanking = buildRanking(scan, i => i.categories ?? [], 'Sin nicho')

  return {
    total: scan.length,
    active,
    inactive: scan.length - active,
    withoutInstagram: scan.length - withInstagram,
    withInstagram,
    withoutCommune,
    withoutAddress,
    missingAnyRequired,
    duplicateGroups: groups.length,
    duplicateRecords: dupRecordIds.size,
    duplicatesByEmail: byEmail,
    duplicatesByInstagram: byInstagram,
    duplicatesByMixed: byMixed,
    communeRanking,
    nicheRanking,
  }
}

export { normUrl, normHandle, normEmail }
