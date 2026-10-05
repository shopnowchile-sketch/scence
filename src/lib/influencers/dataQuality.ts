import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLocationRows, type LocationNode } from '@/lib/influencer-location'

/**
 * Estado de la ubicación canónica (influencers.location_id → locations):
 * - ok: location_id resuelve a una ubicación activa con toda su cadena activa.
 * - missing: location_id IS NULL → "Sin ubicación".
 * - orphan: location_id (o un ancestro) no existe en locations.
 * - inactive: la ubicación o un ancestro está inactivo.
 * Nunca se usa country/city/commune legacy como respaldo.
 */
export type LocationStatus = 'ok' | 'missing' | 'orphan' | 'inactive'

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
  location_id: string | null
  location_status: LocationStatus
  /** Cadena de locations desde la raíz (país) hasta location_id; vacía si status ≠ ok. */
  location_path: GeographyNode[]
  address: string | null
}

export interface GeographyNode {
  id: string
  parent_id: string | null
  name: string
  level: LocationNode['level']
}

/** Nodo usado por alguna influencer; `direct` = influencers cuyo location_id es este nodo. */
export interface GeographyCountNode extends GeographyNode {
  direct: number
}

/** Fila mínima para los listados del drilldown (sin email ni datos de contacto). */
export interface GeographyInfluencer {
  id: string
  display_name: string | null
  instagram_username: string | null
  is_active: boolean
  location_status: LocationStatus
  /** location_id solo si la ubicación es válida; null en cualquier otro caso. */
  location_id: string | null
}

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
  withoutLocation: number
  orphanLocation: number
  inactiveLocation: number
  withoutAddress: number
  missingAnyRequired: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagram: number
  duplicatesByMixed: number
  /**
   * Nodos de locations con influencers (y sus ancestros), con conteo directo.
   * Los totales por país/región/comuna se derivan sumando el subárbol.
   * Solo incluye ubicaciones válidas (status ok); el resto se cuenta aparte.
   */
  geographyNodes: GeographyCountNode[]
  geographyInfluencers: GeographyInfluencer[]
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

function extractInstagramHandle(url: string | null, username: string | null): string | null {
  const fromUsername = normHandle(username)
  if (fromUsername) return fromUsername
  if (!url) return null

  let u = url.trim().toLowerCase()
  if (!u) return null
  const stripped = u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const domainMatch = stripped.match(/^(?:www\.)?instagram\.com\/([^/]+)/)
  if (domainMatch) return normHandle(domainMatch[1])
  if (/^(?:https?:\/\/|www\.)/i.test(u)) return null
  const raw = stripped.replace(/^\/+/, '').split('/')[0]
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
        id, display_name, email, is_active, created_at, location_id, address,
        social_profiles:influencer_social_profiles ( platform, profile_url, username, followers )
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const inf of data) {
      if (seenIds.has(inf.id)) continue
      seenIds.add(inf.id)
      const profiles = (inf.social_profiles ?? []) as Array<{
        platform: string; profile_url: string | null; username: string | null; followers: number | null
      }>
      const ig = profiles.find(p => p.platform === 'instagram')
      const totalFollowers = ig?.followers ?? 0
      all.push({
        id: inf.id,
        display_name: inf.display_name,
        email: inf.email,
        is_active: inf.is_active !== false,
        created_at: inf.created_at,
        instagram_url: ig?.profile_url ?? null,
        instagram_username: ig?.username ?? null,
        followers: totalFollowers,
        commune: null,
        location_id: (inf as { location_id?: string | null }).location_id ?? null,
        location_status: 'missing',
        location_path: [],
        address: (inf as { address?: string | null }).address ?? null,
      })
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  const locationsById = new Map((await loadLocationRows(admin)).map(row => [row.id, row]))
  return all.map(inf => {
    const resolved = resolveLocation(inf.location_id, locationsById)
    return { ...inf, ...resolved }
  })
}

function resolveLocation(
  locationId: string | null,
  locationsById: Map<string, LocationNode>,
): Pick<ScanInfluencer, 'commune' | 'location_status' | 'location_path'> {
  if (!locationId) return { commune: null, location_status: 'missing', location_path: [] }

  const path: GeographyNode[] = []
  const visited = new Set<string>()
  let currentId: string | null = locationId
  while (currentId) {
    const node = locationsById.get(currentId)
    if (!node || visited.has(currentId)) return { commune: null, location_status: 'orphan', location_path: [] }
    if (!node.is_active) return { commune: null, location_status: 'inactive', location_path: [] }
    visited.add(currentId)
    path.unshift({ id: node.id, parent_id: node.parent_id, name: node.name, level: node.level })
    currentId = node.parent_id
  }

  return {
    commune: path.find(node => node.level === 'commune')?.name ?? null,
    location_status: 'ok',
    location_path: path,
  }
}

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

export function buildReport(scan: ScanInfluencer[], groups: DuplicateGroup[]): DataQualityReport {
  const usedNodes = new Map<string, GeographyCountNode>()
  for (const inf of scan) {
    inf.location_path.forEach((node, idx) => {
      const entry = usedNodes.get(node.id) ?? { ...node, direct: 0 }
      if (idx === inf.location_path.length - 1) entry.direct++
      usedNodes.set(node.id, entry)
    })
  }

  const active = scan.filter(i => i.is_active).length
  const withInstagram = scan.filter(i => extractInstagramHandle(i.instagram_url, i.instagram_username)).length
  const withoutLocation = scan.filter(i => i.location_status === 'missing').length
  const orphanLocation = scan.filter(i => i.location_status === 'orphan').length
  const inactiveLocation = scan.filter(i => i.location_status === 'inactive').length
  const withoutAddress = scan.filter(i => !i.address || !i.address.trim()).length
  const missingAnyRequired = scan.filter(i =>
    !extractInstagramHandle(i.instagram_url, i.instagram_username) || i.location_status !== 'ok' || !i.address?.trim()
  ).length

  const dupRecordIds = new Set<string>()
  let byEmail = 0, byInstagram = 0, byMixed = 0
  for (const g of groups) {
    g.influencers.forEach(i => dupRecordIds.add(i.id))
    if (g.type === 'email') byEmail += g.influencers.length - 1
    else if (g.type === 'instagram') byInstagram += g.influencers.length - 1
    else byMixed += g.influencers.length - 1
  }

  return {
    total: scan.length,
    active,
    inactive: scan.length - active,
    withoutInstagram: scan.length - withInstagram,
    withInstagram,
    withoutLocation,
    orphanLocation,
    inactiveLocation,
    withoutAddress,
    missingAnyRequired,
    duplicateGroups: groups.length,
    duplicateRecords: dupRecordIds.size,
    duplicatesByEmail: byEmail,
    duplicatesByInstagram: byInstagram,
    duplicatesByMixed: byMixed,
    geographyNodes: Array.from(usedNodes.values()),
    geographyInfluencers: scan.map(i => ({
      id: i.id,
      display_name: i.display_name,
      instagram_username: extractInstagramHandle(i.instagram_url, i.instagram_username),
      is_active: i.is_active,
      location_status: i.location_status,
      location_id: i.location_status === 'ok' ? i.location_id : null,
    })),
  }
}

export { normUrl, normHandle, normEmail }
