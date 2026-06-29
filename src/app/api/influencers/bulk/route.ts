import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { normUrl, normEmail } from '@/lib/influencers/dataQuality'

/**
 * POST /api/influencers/bulk  — versión optimizada (batch)
 *
 * Antes: ~2800 queries para 1400 filas (1 insert por fila)
 * Ahora: ~8 queries totales sin importar el volumen
 *
 * Estrategia:
 *  1. 1 query → fetch existentes por email
 *  2. 1 query → batch insert todos los nuevos
 *  3. 1 query → fetch IDs de los recién insertados
 *  4. 1 query → batch insert todos los social profiles nuevos
 *  5. Para updates: 1 batch fetch de social_profiles existentes
 *     + 1 batch insert de perfiles faltantes
 *     + updates individuales solo cuando hay patch real (raro en primera importación)
 */

export interface BulkRow {
  display_name?: string
  email?: string
  phone?: string
  city?: string
  country?: string
  bio?: string
  categories?: string
  instagram?: string | number
  tiktok?: string | number
  youtube?: string | number
  twitter?: string | number
  facebook?: string | number
  linkedin?: string | number
  instagram_url?: string
  tiktok_url?: string
  [key: string]: unknown
}

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'] as const
type Platform = typeof PLATFORMS[number]

function toNum(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

function parseCategories(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
  return []
}

function extractUsername(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    const parts = path.split('/').filter(Boolean)
    const last = parts[parts.length - 1] ?? ''
    return last.startsWith('@') ? last.slice(1) : last || null
  } catch {
    return null
  }
}

function cleanUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw.trim())
    // Eliminar query params y hash (ej: ?igshid=xxx, ?s=xxx)
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    // URL relativa o sin protocolo — limpiar manualmente
    return raw.trim().split('?')[0].split('#')[0].replace(/\/$/, '') || undefined
  }
}

function buildSocialProfiles(row: BulkRow) {
  const profileUrls: Partial<Record<Platform, string>> = {
    instagram: cleanUrl(row.instagram_url ? String(row.instagram_url) : undefined),
    tiktok:    cleanUrl(row.tiktok_url    ? String(row.tiktok_url)    : undefined),
  }
  return PLATFORMS
    .map(p => {
      const url = profileUrls[p] ?? null
      return {
        platform:    p as Platform,
        followers:   toNum(row[p]),
        profile_url: url,
        username:    row[`${p}_username`]
          ? String(row[`${p}_username`])
          : extractUsername(url),
      }
    })
    // username is NOT NULL in DB schema — skip profiles where we can't derive a username
    .filter(sp => (sp.followers > 0 || !!sp.profile_url) && sp.username !== null)
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: { rows: BulkRow[] }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const rows: BulkRow[] = body.rows ?? []
  const requireInstagram = (body as { requireInstagram?: boolean }).requireInstagram === true
  if (!rows.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  if (rows.length > 1500) return NextResponse.json({ error: 'Max 1500 rows per batch' }, { status: 400 })

  // ── 1. Fetch existentes por email (1 query) ──────────────────────────────────
  const emails = rows.map(r => normEmail(r.email as string)).filter(Boolean) as string[]

  const { data: existingInfs } = await admin
    .from('influencers')
    .select('id, email, display_name')
    .eq('organization_id', orgId)
    .in('email', emails.length ? emails : ['__none__'])

  const existingEmails = new Set((existingInfs ?? []).map(e => normEmail(e.email)).filter(Boolean) as string[])

  // ── 1b. Fetch instagram_urls existentes (de social_profiles, platform=instagram) ──
  const { data: existingIgProfiles } = await admin
    .from('influencer_social_profiles')
    .select('profile_url, influencer:influencers!inner(organization_id)')
    .eq('platform', 'instagram')
    .eq('influencer.organization_id', orgId)
    .not('profile_url', 'is', null)

  const existingIgUrls = new Set(
    (existingIgProfiles ?? [])
      .map(p => normUrl((p as { profile_url: string | null }).profile_url))
      .filter(Boolean) as string[]
  )

  // ── 2. Separar filas: nuevas vs omitidas (dedup por email + instagram_url) ────
  const toInsert: BulkRow[] = []
  let skippedEmpty = 0
  let skippedByEmail = 0
  let skippedByInstagramUrl = 0
  let skippedNoInstagram = 0
  const errors: Array<{ row: number; error: string }> = []

  // Sets para detectar duplicados DENTRO del mismo archivo
  const seenEmails = new Set<string>()
  const seenIgUrls = new Set<string>()

  rows.forEach(row => {
    const emailKey = normEmail(row.email as string)
    const igKey = normUrl(row.instagram_url as string)

    // Fila vacía
    if (!row.display_name && !row.email && !igKey) { skippedEmpty++; return }

    // Validación opcional: requiere instagram_url
    if (requireInstagram && !igKey) { skippedNoInstagram++; return }

    // Dedup por email (DB o dentro del archivo)
    if (emailKey && (existingEmails.has(emailKey) || seenEmails.has(emailKey))) {
      skippedByEmail++; return
    }
    // Dedup por instagram_url (DB o dentro del archivo)
    if (igKey && (existingIgUrls.has(igKey) || seenIgUrls.has(igKey))) {
      skippedByInstagramUrl++; return
    }

    if (emailKey) seenEmails.add(emailKey)
    if (igKey) seenIgUrls.add(igKey)
    toInsert.push(row)
  })

  const skipped = skippedEmpty + skippedByEmail + skippedByInstagramUrl + skippedNoInstagram

  // ── 3. Batch insert nuevos influencers (1 query) ─────────────────────────────
  let created = 0
  const newInfluencerSocialProfiles: Array<{
    influencer_id: string
    platform: Platform
    username: string | null
    followers: number
    profile_url: string | null
    is_primary: boolean
  }> = []

  if (toInsert.length > 0) {
    // Supabase max upsert chunk = 1000; split if needed
    const CHUNK = 1000
    for (let c = 0; c < toInsert.length; c += CHUNK) {
      const chunk = toInsert.slice(c, c + CHUNK)
      const insertPayload = chunk.map(row => ({
        organization_id: orgId,
        display_name: row.display_name || row.email?.split('@')[0] || 'Sin nombre',
        email: row.email || null,
        phone: row.phone || null,
        city: row.city || null,
        country: row.country || null,
        bio: row.bio || null,
        categories: parseCategories(row.categories),
        is_active: true,
        is_verified: false,
      }))

      const { data: inserted, error: insertErr } = await admin
        .from('influencers')
        .insert(insertPayload)
        .select('id, email, display_name')

      if (insertErr || !inserted) {
        errors.push({ row: c + 1, error: insertErr?.message ?? 'Batch insert failed' })
        continue
      }

      created += inserted.length

      // Map by email (primary), fall back to display_name for rows without email
      const emailToId = new Map(inserted
        .filter(inf => inf.email)
        .map(inf => [inf.email!.toLowerCase(), inf.id]))
      const nameToId = new Map(inserted
        .filter(inf => !inf.email && inf.display_name)
        .map(inf => [inf.display_name.toLowerCase(), inf.id]))

      chunk.forEach(row => {
        const infId = row.email
          ? emailToId.get(row.email.toLowerCase())
          : nameToId.get((row.display_name ?? '').toLowerCase())
        if (!infId) return
        const sps = buildSocialProfiles(row)
        sps.forEach((sp, idx) => {
          newInfluencerSocialProfiles.push({
            influencer_id: infId,
            platform: sp.platform,
            username: sp.username,
            followers: sp.followers,
            profile_url: sp.profile_url,
            is_primary: idx === 0,
          })
        })
      })
    }

    // ── 4. Batch insert social profiles de nuevos (1 query) ───────────────────
    if (newInfluencerSocialProfiles.length > 0) {
      const CHUNK_SP = 1000
      for (let c = 0; c < newInfluencerSocialProfiles.length; c += CHUNK_SP) {
        const { error: spErr } = await admin
          .from('influencer_social_profiles')
          .insert(newInfluencerSocialProfiles.slice(c, c + CHUNK_SP))
        if (spErr) console.error('[bulk] social profiles insert chunk', c, spErr.message)
      }
    }
  }

  // ── Reporte final de importación ─────────────────────────────────────────────
  // Política: NO se actualizan registros existentes. Solo se importan registros
  // nuevos (que no existan por email ni por instagram_url). Los duplicados se omiten.
  return NextResponse.json({
    created,            // registros nuevos importados
    updated: 0,         // (legacy) ya no se actualizan existentes
    imported: created,
    skipped,
    skippedByEmail,           // omitidos por email duplicado
    skippedByInstagramUrl,    // omitidos por instagram_url duplicada
    skippedNoInstagram,       // omitidos por falta de instagram_url (si requireInstagram)
    skippedEmpty,             // filas vacías
    errors,
    total: rows.length,       // total de filas en el archivo
    totalImported: created,   // total final importado
  })
}
