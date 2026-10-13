import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { sanitizeSearchTerm } from '@/lib/campaign-field-guards'
import { crmCacheVersion, bumpCrmCacheVersion } from '@/lib/crm-cache-version'

// Módulo CRM — aislado, no toca brands/influencers/campaigns.
// Solo super_admin / brand_manager (mismo criterio que useIsAdmin / Sidebar admin).
// Cruza emails de leads contra auth.users (mismo método admin.auth.admin.listUsers()
// ya usado en /api/brands y /api/brands/[id]/invite para last_sign_in_at, solo que
// ahí se busca por user_id y acá por email — un lead recién queda vinculado a un
// user_id cuando se registra, antes de eso el único dato que tenemos es el email).
// Solo lectura de Auth, sin tocar nada — para saber "quién se conectó a la app".
async function buildAuthEmailMap(admin: ReturnType<typeof createAdminClient>) {
  const map = new Map<string, string | null>() // email (lowercase) -> last_sign_in_at
  let page = 1
  const perPage = 1000
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) break
    for (const u of data.users) {
      if (u.email) map.set(u.email.toLowerCase(), u.last_sign_in_at ?? null)
    }
    if (data.users.length < perPage) break
    page++
  }
  return map
}

const EMAIL_STATUS_EVENT_TYPES: Record<string, string[]> = {
  sent: ['email.sent'],
  delivered: ['email.delivered'],
  opened: ['email.opened'],
  clicked: ['email.clicked'],
  engaged: ['email.opened', 'email.clicked'],
  failed: ['email.failed'],
  bounced: ['email.bounced'],
  failed_bounced: ['email.failed', 'email.bounced'],
}

type EmailEventSets = Record<'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' | 'bounced', Set<string>>

function getEmailEventLeadIds(emailStatus: string, emailEventSets: EmailEventSets) {
  const eventTypes = EMAIL_STATUS_EVENT_TYPES[emailStatus]
  if (!eventTypes) return null

  const setByEventType: Record<string, Set<string>> = {
    'email.sent': emailEventSets.sent,
    'email.delivered': emailEventSets.delivered,
    'email.opened': emailEventSets.opened,
    'email.clicked': emailEventSets.clicked,
    'email.failed': emailEventSets.failed,
    'email.bounced': emailEventSets.bounced,
  }
  return Array.from(new Set(eventTypes.flatMap(eventType => Array.from(setByEventType[eventType] ?? []))))
}

function applyContactDataFilter(query: any, contactData: string) {
  if (contactData === 'has_email') return query.not('email', 'is', null).neq('email', '')
  if (contactData === 'missing_email') return query.or('email.is.null,email.eq.')
  return query
}

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

// Columnas donde busca el buscador del CRM: contacto + rubro/actividad (incluye el
// código de actividad, ej. "181010") + ubicación + origen. Un solo criterio para el
// listado y para "seleccionar todos los que cumplen el filtro".
const SEARCH_COLUMNS = [
  'company_name', 'contact_name', 'email', 'instagram', 'phone_1', 'company_rut',
  'industry', 'economic_activity', 'industry_filter', 'position',
  'commune', 'source', 'website',
]
function searchFilter(search: string) {
  return SEARCH_COLUMNS.map(column => `${column}.ilike.%${search}%`).join(',')
}

// ── Lectura paralela + caché corta ───────────────────────────────────────────
// Antes cada carga del listado recorría en serie ~55 páginas (eventos de email,
// usuarios de auth y TODA la tabla de leads solo para sacar comunas/fuentes)
// antes de devolver 50 filas. Ahora las páginas se piden en paralelo y el
// resultado se reutiliza 60 s (los filtros/paginación no deberían recalcularlo).
const CACHE_TTL_MS = 60_000
type Admin = ReturnType<typeof createAdminClient>

function cachedLoader<T>(load: (admin: Admin) => Promise<T>) {
  let value: T | null = null
  let at = 0
  let ver = -1
  let inflight: Promise<T> | null = null
  return (admin: Admin): Promise<T> => {
    if (value !== null && ver === crmCacheVersion() && Date.now() - at < CACHE_TTL_MS) return Promise.resolve(value)
    const loadingVer = crmCacheVersion()
    inflight ??= load(admin)
      .then(result => { value = result; at = Date.now(); ver = loadingVer; return result })
      .finally(() => { inflight = null })
    return inflight
  }
}

async function fetchAllPages<T>(
  total: number,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const PAGE = 1000
  const CONCURRENCY = 6
  const starts = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE)
  const out: T[] = []
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    const results = await Promise.all(starts.slice(i, i + CONCURRENCY).map(from => fetchPage(from, from + PAGE - 1)))
    for (const r of results) {
      if (r.error) throw new Error(r.error.message)
      out.push(...(r.data ?? []))
    }
  }
  return out
}

function emptyEmailEventSets(): EmailEventSets {
  return { sent: new Set<string>(), delivered: new Set<string>(), opened: new Set<string>(), clicked: new Set<string>(), failed: new Set<string>(), bounced: new Set<string>() }
}

const getEmailEventSets = cachedLoader(async admin => {
  const { count, error } = await admin
    .from('crm_email_events')
    .select('id', { count: 'exact', head: true })
    .not('lead_id', 'is', null)
  if (error) throw new Error(error.message)

  const rows = await fetchAllPages<{ lead_id: string | null; event_type: string | null }>(count ?? 0, (from, to) =>
    admin.from('crm_email_events').select('lead_id, event_type').not('lead_id', 'is', null).range(from, to))

  const sets = emptyEmailEventSets()
  const setByType: Record<string, Set<string>> = {
    'email.sent': sets.sent, 'email.delivered': sets.delivered, 'email.opened': sets.opened,
    'email.clicked': sets.clicked, 'email.failed': sets.failed, 'email.bounced': sets.bounced,
  }
  for (const row of rows) {
    if (row.lead_id && row.event_type) setByType[row.event_type]?.add(row.lead_id)
  }
  return sets
})

const getAuthEmailMap = cachedLoader(buildAuthEmailMap)

const getLeadCatalog = cachedLoader(async admin => {
  const { count, error } = await admin.from('crm_leads').select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)

  const rows = await fetchAllPages<{ commune: string | null; source: string | null }>(count ?? 0, (from, to) =>
    admin.from('crm_leads').select('commune, source').range(from, to))

  const communes = new Set<string>()
  const sources = new Set<string>()
  for (const r of rows) {
    if (r.commune) communes.add(r.commune)
    if (r.source) sources.add(r.source)
  }
  return { communes: Array.from(communes).sort(), sources: Array.from(sources).sort() }
})

// ── GET /api/crm-leads — lista paginada con filtros ───────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  // Se interpola en .or() de PostgREST: se limpia antes (sin inyección de filtros).
  const search = sanitizeSearchTerm(searchParams.get('search'))
  const qualification = searchParams.get('qualification') ?? ''
  const region = searchParams.get('region') ?? ''
  const source = searchParams.get('source') ?? ''
  const industry = searchParams.get('industry') ?? ''
  const commune = searchParams.get('commune') ?? ''
  const emailStatus = searchParams.get('email_status') ?? ''
  const contactData = searchParams.get('contact_data') ?? ''
  const idsOnly = searchParams.get('ids_only') === '1'
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  const emailEventSets = await getEmailEventSets(admin).catch(error => {
    console.error('[GET /api/crm-leads email events]', error)
    return emptyEmailEventSets()
  })

  // ── ids_only: trae TODOS los ids que cumplen el filtro (no solo la página
  // actual) — usado por "Seleccionar todos los que cumplen el filtro" en el
  // CRM. Reusa los mismos filtros que el listado paginado. Corta antes de
  // hacer el enriquecimiento (auth map, sources, etc.) que no se necesita acá.
  if (idsOnly) {
    const buildIdsQuery = (eventLeadIds?: string[]) => {
      let q: any = admin.from('crm_leads').select('id').order('created_at', { ascending: false })
      if (qualification) q = q.eq('qualification_status', qualification)
      if (region) q = q.eq('region', region)
      if (source) q = q.eq('source', source)
      if (industry) q = q.eq('industry', industry)
      if (commune) q = q.eq('commune', commune)
      q = applyContactDataFilter(q, contactData)
      if (eventLeadIds) q = q.in('id', eventLeadIds)
      if (emailStatus === 'not_sent') q = q.is('contacted_at', null)
      if (search) q = q.or(searchFilter(search))
      return q
    }

    const allIds = new Set<string>()
    const PAGE = 1000
    const eventLeadIds = getEmailEventLeadIds(emailStatus, emailEventSets)
    const idChunks = eventLeadIds === null ? [undefined] : chunksOf(eventLeadIds, 200)

    for (const idChunk of idChunks) {
      let from = 0
      for (;;) {
        const { data: rows, error: idsError } = await buildIdsQuery(idChunk).range(from, from + PAGE - 1)
        if (idsError) {
          console.error('[GET /api/crm-leads ids_only]', idsError)
          return NextResponse.json({ error: idsError.message }, { status: 500 })
        }
        if (!rows || rows.length === 0) break
        for (const r of rows as Array<{ id: string }>) allIds.add(r.id)
        if (rows.length < PAGE || allIds.size >= 20000) break
        from += PAGE
      }
      if (allIds.size >= 20000) break
    }

    return NextResponse.json({ ids: Array.from(allIds).slice(0, 20000) })
  }

  // Auth map y catálogo no dependen de la página: se piden en paralelo con la query de leads (y con caché).
  const authMapPromise = getAuthEmailMap(admin)
  const catalogPromise = getLeadCatalog(admin)

  const leadFields = 'id, contact_name, company_name, email, phone_1, instagram, commune, region, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at'
  const buildLeadsQuery = (eventLeadIds?: string[], withCount = false) => {
    let q: any = withCount
      ? admin.from('crm_leads').select(leadFields, { count: 'exact' })
      : admin.from('crm_leads').select(leadFields)
    q = q.order('created_at', { ascending: false })
    if (qualification) q = q.eq('qualification_status', qualification)
    if (region) q = q.eq('region', region)
    if (source) q = q.eq('source', source)
    if (industry) q = q.eq('industry', industry)
    if (commune) q = q.eq('commune', commune)
    q = applyContactDataFilter(q, contactData)
    if (eventLeadIds) q = q.in('id', eventLeadIds)
    if (emailStatus === 'not_sent') q = q.is('contacted_at', null)
    if (search) q = q.or(searchFilter(search))
    return q
  }

  const eventLeadIds = getEmailEventLeadIds(emailStatus, emailEventSets)
  let data: any[] = []
  let count = 0

  if (eventLeadIds !== null) {
    const matchingById = new Map<string, any>()
    for (const idChunk of chunksOf(eventLeadIds, 200)) {
      const { data: rows, error } = await buildLeadsQuery(idChunk)
      if (error) {
        console.error('[GET /api/crm-leads email filter]', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      for (const row of rows ?? []) matchingById.set(row.id, row)
    }
    const matching = Array.from(matchingById.values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    count = matching.length
    data = matching.slice((page - 1) * limit, page * limit)
  } else {
    const query = buildLeadsQuery(undefined, true).range((page - 1) * limit, page * limit - 1)
    const result = await query
    if (result.error) {
      console.error('[GET /api/crm-leads]', result.error)
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }
    data = result.data ?? []
    count = result.count ?? 0
  }

  const authMap = await authMapPromise.catch(error => {
    console.error('[GET /api/crm-leads auth map]', error)
    return new Map<string, string | null>()
  })

  const leadIds = (data ?? []).map((lead: { id: string }) => lead.id)
  const openedMap = new Map<string, string | null>()

  if (leadIds.length > 0) {
    const { data: openEvents, error: openEventsError } = await admin
      .from('crm_email_events')
      .select('lead_id, event_type, created_at')
      .in('lead_id', leadIds)
      .eq('event_type', 'email.opened')
      .order('created_at', { ascending: false })

    if (!openEventsError) {
      for (const event of openEvents ?? []) {
        if (event.lead_id && !openedMap.has(event.lead_id)) {
          openedMap.set(event.lead_id, event.created_at ?? null)
        }
      }
    }
  }

  const enriched = (data ?? []).map((row: any) => {
    const l = row
    const lastSignIn = l.email ? authMap.get(l.email.toLowerCase()) ?? null : null
    const openedAt = openedMap.get(l.id) ?? null

    return {
      ...l,
      app_connected: authMap.has((l.email ?? '').toLowerCase()),
      app_last_sign_in_at: lastSignIn,
      email_opened: Boolean(openedAt),
      email_opened_at: openedAt,
    }
  })

  const { communes, sources } = await catalogPromise.catch(error => {
    console.error('[GET /api/crm-leads catalog]', error)
    return { communes: [] as string[], sources: [] as string[] }
  })

  const stats = {
    sent: emailEventSets.sent.size,
    delivered: emailEventSets.delivered.size,
    opened: emailEventSets.opened.size,
    clicked: emailEventSets.clicked.size,
    failed: emailEventSets.failed.size,
    bounced: emailEventSets.bounced.size,
    openRate: emailEventSets.sent.size > 0 ? Math.round((emailEventSets.opened.size / emailEventSets.sent.size) * 100) : 0,
  }

  return NextResponse.json({ data: enriched, total: count, page, limit, communes, sources, stats })
}

// ── POST /api/crm-leads — crear lead manual ──────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  const companyName = typeof body.company_name === 'string' ? body.company_name.trim() : ''
  const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone1 = typeof body.phone_1 === 'string' ? body.phone_1.trim() : ''
  const instagram = typeof body.instagram === 'string' ? body.instagram.trim() : ''
  const commune = typeof body.commune === 'string' ? body.commune.trim() : ''
  const region = typeof body.region === 'string' ? body.region.trim() : ''
  const industry = typeof body.industry === 'string' ? body.industry.trim() : ''
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual'

  if (!companyName && !email && !instagram) {
    return NextResponse.json({ error: 'Debes ingresar al menos empresa, email o Instagram' }, { status: 422 })
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 422 })
  }

  if (email) {
    const { data: existing } = await admin
      .from('crm_leads')
      .select('id, company_name, email')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Ya existe un lead con ese email' }, { status: 409 })
    }
  }

  const { data: lead, error } = await admin
    .from('crm_leads')
    .insert({
      company_name: companyName || null,
      contact_name: contactName || null,
      email: email || null,
      phone_1: phone1 || null,
      instagram: instagram || null,
      commune: commune || null,
      region: region || null,
      industry: industry || null,
      source,
      qualification_status: 'unqualified',
      imported_at: new Date().toISOString(),
    })
    .select('id, contact_name, company_name, email, phone_1, instagram, commune, region, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at')
    .single()

  if (error) {
    console.error('[POST /api/crm-leads]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  bumpCrmCacheVersion()
  await admin.from('crm_lead_activities').insert({
    lead_id: lead.id,
    action_type: 'created',
    description: 'Lead creado manualmente',
    created_by: user.id,
  })

  return NextResponse.json({
    data: {
      ...lead,
      app_connected: false,
      app_last_sign_in_at: null,
    },
  })
}
