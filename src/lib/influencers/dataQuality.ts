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
}

export interface DuplicateGroup {
  key: string
  type: 'email' | 'instagram_url' | 'instagram'
  value: string
  influencers: ScanInfluencer[]
}

export interface DataQualityReport {
  total: number
  active: number
  inactive: number
  withoutInstagram: number
  withInstagram: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagramUrl: number
  duplicatesByInstagram: number
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

/** Carga todos los influencers de la org con su perfil de Instagram resuelto. */
export async function loadScan(admin: SupabaseClient, orgId: string): Promise<ScanInfluencer[]> {
  const PAGE = 1000
  let from = 0
  const all: ScanInfluencer[] = []

  for (;;) {
    const { data, error } = await admin
      .from('influencers')
      .select(`
        id, display_name, email, is_active, created_at,
        social_profiles:influencer_social_profiles ( platform, profile_url, username, followers )
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    for (const inf of data) {
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
      })
    }

    if (data.length < PAGE) break
    from += PAGE
  }

  return all
}

/** Agrupa duplicados por email, instagram_url e instagram (username). */
export function findDuplicates(scan: ScanInfluencer[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const seen = new Set<string>() // ids ya asignados a un grupo (un id puede aparecer en varios tipos)

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
      const groupKey = `${type}:${value}`
      // marca ids
      list.forEach((i: ScanInfluencer) => seen.add(i.id))
      groups.push({ key: groupKey, type, value, influencers: list })
    }
  }

  buildFor('email', i => normEmail(i.email))
  buildFor('instagram_url', i => normUrl(i.instagram_url))
  buildFor('instagram', i => normHandle(i.instagram_username))

  return groups
}

export function buildReport(scan: ScanInfluencer[], groups: DuplicateGroup[]): DataQualityReport {
  const active = scan.filter(i => i.is_active).length
  const withInstagram = scan.filter(i => i.instagram_url || i.instagram_username).length
  const dupRecordIds = new Set<string>()
  let byEmail = 0, byUrl = 0, byHandle = 0
  for (const g of groups) {
    g.influencers.forEach(i => dupRecordIds.add(i.id))
    if (g.type === 'email') byEmail += g.influencers.length - 1
    else if (g.type === 'instagram_url') byUrl += g.influencers.length - 1
    else byHandle += g.influencers.length - 1
  }
  return {
    total: scan.length,
    active,
    inactive: scan.length - active,
    withoutInstagram: scan.length - withInstagram,
    withInstagram,
    duplicateGroups: groups.length,
    duplicateRecords: dupRecordIds.size,
    duplicatesByEmail: byEmail,
    duplicatesByInstagramUrl: byUrl,
    duplicatesByInstagram: byHandle,
  }
}

export { normUrl, normHandle, normEmail }
