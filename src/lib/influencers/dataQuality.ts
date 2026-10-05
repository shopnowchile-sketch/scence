import type { SupabaseClient } from '@supabase/supabase-js'
import { getOfficialLocationDisplayMap } from '@/lib/influencer-location'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

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
  region: string | null
  location_id: string | null
  address: string | null
  categories: string[] | null
  locationLevel: 'country' | 'region' | 'city' | 'commune' | null
  locationName: string | null
  locationAncestors: Array<{ id: string; level: 'country' | 'region' | 'city' | 'commune'; name: string }>
}

export interface RankingItem {
  value: string | null
  label: string
  count: number
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
  withoutCommune: number
  withoutAddress: number
  missingAnyRequired: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagram: number
  duplicatesByMixed: number
  nicheRanking: RankingItem[]
  geography: GeographyCountry[]
}

export interface GeographyInfluencer {
  id: string
  display_name: string | null
  email: string | null
  instagram_username: string | null
  followers: number
  is_active: boolean
  address: string | null
}

export interface GeographyNode {
  id: string
  label: string
  level: 'country' | 'region' | 'city' | 'commune'
  count: number
  children: GeographyNode[]
  influencers: GeographyInfluencer[]
}

export type GeographyCountry = GeographyNode

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
        id, display_name, email, is_active, created_at, location_id, address, categories,
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
        region: null,
        location_id: (inf as { location_id?: string | null }).location_id ?? null,
        address: (inf as { address?: string | null }).address ?? null,
        categories: (inf as { categories?: string[] | null }).categories ?? null,
      })
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  const [locationDisplayById, locationRowsResult] = await Promise.all([
    getOfficialLocationDisplayMap(admin),
    fetchAllRows(
      (from, to) => admin.from('locations')
        .select('id, parent_id, level, name, is_active')
        .eq('is_active', true)
        .neq('level', 'place')
        .range(from, to),
      { maxRows: 5000 },
    ),
  ])
  if (locationRowsResult.error) throw locationRowsResult.error

  type LocationNode = { id: string; parent_id: string | null; level: 'country' | 'region' | 'city' | 'commune'; name: string; is_active: boolean }
  const locationById = new Map<string, LocationNode>((locationRowsResult.data ?? []) as LocationNode[]).entries()
  const locationMap = new Map<string, LocationNode>(locationById)

  return all.map(inf => {
    const path: LocationNode[] = []
    let current = inf.location_id ? locationMap.get(inf.location_id) : undefined
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      path.push(current)
      current = current.parent_id ? locationMap.get(current.parent_id) : undefined
    }
    path.reverse()
    const display = inf.location_id ? locationDisplayById.get(inf.location_id) : undefined
    return {
      ...inf,
      location_id: inf.location_id ?? null,
      commune: display?.commune ?? null,
      region: display?.region ?? null,
      locationLevel: path[path.length - 1]?.level ?? null,
      locationName: path[path.length - 1]?.name ?? null,
      locationAncestors: path.map(node => ({ id: node.id, level: node.level, name: node.name })),
    }
  })
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

function normalizeRankingKey(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-CL')
}

function buildRanking(
  scan: ScanInfluencer[],
  getValues: (i: ScanInfluencer) => (string | null)[],
  noneLabel: string,
): RankingItem[] {
  const counts = new Map<string, { label: string; count: number }>()
  let none = 0

  for (const inf of scan) {
    const values = Array.from(new Set(
      getValues(inf)
        .map(v => v?.normalize('NFC').replace(/\s+/g, ' ').trim())
        .filter((v): v is string => Boolean(v))
    ))

    if (values.length === 0) {
      none++
      continue
    }

    for (const value of values) {
      const key = normalizeRankingKey(value)
      const existing = counts.get(key)
      counts.set(key, {
        // Geography comes from locations, so the first label is already the
        // official catalog spelling (e.g. "Las Condes", never "Las condes").
        label: existing?.label ?? value,
        count: (existing?.count ?? 0) + 1,
      })
    }
  }

  const items: RankingItem[] = Array.from(counts.values()).map(({ label, count }) => ({
    value: label,
    label,
    count,
  }))

  items.push({ value: null, label: noneLabel, count: none })
  return items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es-CL'))
}

export function buildReport(scan: ScanInfluencer[], groups: DuplicateGroup[]): DataQualityReport {
export function buildReport(scan: ScanInfluencer[], groups: DuplicateGroup[]): DataQualityReport {
  const active = scan.filter(i => i.is_active).length
  const withInstagram = scan.filter(i => extractInstagramHandle(i.instagram_url, i.instagram_username)).length
  // A valid commune means the canonical location itself is a commune.
  // Region/country assignments are intentionally incomplete for portal access.
  const withoutCommune = scan.filter(i => !i.location_id || !i.commune?.trim()).length
  const withoutAddress = scan.filter(i => !i.address || !i.address.trim()).length
  const missingAnyRequired = scan.filter(i =>
    !extractInstagramHandle(i.instagram_url, i.instagram_username) || !i.commune?.trim() || !i.address?.trim()
  ).length

  const dupRecordIds = new Set<string>()
  let byEmail = 0, byInstagram = 0, byMixed = 0
  for (const g of groups) {
    g.influencers.forEach(i => dupRecordIds.add(i.id))
    if (g.type === 'email') byEmail += g.influencers.length - 1
    else if (g.type === 'instagram') byInstagram += g.influencers.length - 1
    else byMixed += g.influencers.length - 1
  }

  const nicheRanking = buildRanking(scan, i => i.categories ?? [], 'Sin nicho')

  const countryMap = new Map<string, GeographyNode>()
  const influencerForGeo = (inf: ScanInfluencer): GeographyInfluencer => ({
    id: inf.id, display_name: inf.display_name, email: inf.email,
    instagram_username: inf.instagram_username, followers: inf.followers,
    is_active: inf.is_active, address: inf.address,
  })

  for (const inf of scan) {
    const path = inf.locationAncestors
    if (!path.length) continue
    let currentMap = countryMap
    let currentNode: GeographyNode | undefined
    for (const ancestor of path) {
      let node = currentMap.get(ancestor.id)
      if (!node) {
        node = { id: ancestor.id, label: ancestor.name, level: ancestor.level, count: 0, children: [], influencers: [] }
        currentMap.set(ancestor.id, node)
      }
      node.count++
      if (ancestor.id === path[path.length - 1].id) node.influencers.push(influencerForGeo(inf))
      currentNode = node
      currentMap = new Map(node.children.map(child => [child.id, child]))
      // Keep the Map-backed children in sync after inserts.
      if (currentMap.size !== node.children.length) node.children = Array.from(currentMap.values())
    }
  }

  const sortGeo = (nodes: GeographyNode[]): GeographyNode[] => nodes
    .map(node => ({ ...node, children: sortGeo(node.children), influencers: [...node.influencers].sort((a,b) => b.followers-a.followers || (a.display_name ?? '').localeCompare(b.display_name ?? '', 'es-CL')) }))
    .sort((a,b) => b.count-a.count || a.label.localeCompare(b.label, 'es-CL'))

  const geography = sortGeo(Array.from(countryMap.values()))

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
    nicheRanking,
    geography,
  }
}
export { normUrl, normHandle, normEmail }
