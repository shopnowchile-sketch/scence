import { NextRequest, NextResponse } from 'next/server'
import { listOptOuts, normalizeEmail } from '@/lib/email-optouts'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { sanitizeSearchTerm } from '@/lib/campaign-field-guards'
import { crmCacheVersion, bumpCrmCacheVersion } from '@/lib/crm-cache-version'
import { canonicalCommune } from '@/lib/crm-commune'
import { normalizeLeadLocation } from '@/lib/crm-location'

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
  // "No abierto": entregado y sin ninguna apertura registrada.
  if (emailStatus === 'not_opened') return Array.from(emailEventSets.delivered).filter(id => !emailEventSets.opened.has(id))
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

// Bajas, rebotes y quejas: fuente única `email_optouts` (misma que usa el envío masivo).
const getOptOuts = cachedLoader(listOptOuts)

// Última interacción: aperturas o clics en los últimos N días (eventos de email existentes).
async function recentActivityLeadIds(admin: Admin, days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('crm_email_events').select('lead_id')
      .in('event_type', ['email.opened', 'email.clicked']).gte('occurred_at', since).not('lead_id', 'is', null)
      .order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) if (r.lead_id) ids.add(r.lead_id)
    if (!data || data.length < 1000) break
  }
  return Array.from(ids)
}

// Contactos con historial de una campaña (crm_lead_activities ya guarda campaign_id).
async function campaignLeadIds(admin: Admin, campaignId: string) {
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('crm_lead_activities').select('lead_id').eq('campaign_id', campaignId).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) ids.add(r.lead_id)
    if (!data || data.length < 1000) break
  }
  return Array.from(ids)
}

type ExtraFilters = { type: string; country: string; region: string; registration: string; subscription: string }

function applyExtraFilters(query: any, f: ExtraFilters, optouts: Array<{ email: string; reason: string | null }>) {
  let q = query
  if (f.country) q = q.eq('country', f.country)
  if (f.region) q = q.eq('region', f.region)
  if (f.type === 'influencer') q = q.like('source', '%_influencer')
  else if (f.type === 'customer') q = q.like('source', '%_cliente')
  else if (f.type === 'brand') q = q.not('converted_brand_id', 'is', null)
  else if (f.type === 'other') q = q.not('source', 'like', '%_influencer').not('source', 'like', '%_cliente').is('converted_brand_id', null)
  if (f.registration === 'registered') q = q.eq('qualification_status', 'converted')
  else if (f.registration === 'none') q = q.neq('qualification_status', 'converted')
  if (f.subscription) {
    const quote = (emails: string[]) => `(${emails.map(e => `"${e.replace(/"/g, '')}"`).join(',')})`
    const all = optouts.map(o => o.email)
    const byReason = (reasons: string[]) => optouts.filter(o => reasons.includes(o.reason ?? '')).map(o => o.email)
    if (f.subscription === 'subscribed') { q = q.eq('marketing_consent', true); if (all.length) q = q.not('email', 'in', quote(all)) }
    else if (f.subscription === 'unconfirmed') { q = q.is('marketing_consent', null); if (all.length) q = q.not('email', 'in', quote(all)) }
    else if (f.subscription === 'unsubscribed' || f.subscription === 'blocked') {
      const list = f.subscription === 'unsubscribed' ? byReason(['unsubscribe', 'manual']) : byReason(['bounce', 'complaint'])
      q = list.length ? q.in('email', list) : q.in('id', ['00000000-0000-0000-0000-000000000000'])
    }
  }
  return q
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
  'company_name', 'contact_name', 'email', 'instagram', 'phone_1', 'company_rut', 'contact_rut',
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
// 10 min: recalcular eventos (≈100 mil filas), usuarios y catálogo en cada minuto saturaba la base (timeout de 8 s) y el listado fallaba.
// Las escrituras del CRM invalidan la caché (bumpCrmCacheVersion), así que los cambios propios se ven al instante.
const CACHE_TTL_MS = 10 * 60_000

// La primera carga en frío recorre varias tablas: se le da margen para no cortarse con el error HTML de Vercel.
export const maxDuration = 60
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
  const CONCURRENCY = 2
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

  const rows = await fetchAllPages<{ commune: string | null; source: string | null; region: string | null; country: string | null }>(count ?? 0, (from, to) =>
    admin.from('crm_leads').select('commune, source, region, country').range(from, to))

  const communes = new Set<string>()
  const sources = new Set<string>()
  const regions = new Set<string>()
  const countries = new Set<string>()
  // País → Región → Comunas solo con valores que existen en los leads (clave '' = sin país/región).
  const geoMap = new Map<string, Map<string, Set<string>>>()
  for (const r of rows) {
    const c = r.country ?? '', g = r.region ?? ''
    if (c || g || r.commune) {
      const regionsOf = geoMap.get(c) ?? new Map<string, Set<string>>()
      const communesOf = regionsOf.get(g) ?? new Set<string>()
      if (r.commune) communesOf.add(r.commune)
      regionsOf.set(g, communesOf); geoMap.set(c, regionsOf)
    }
    if (r.commune) communes.add(r.commune)
    if (r.source) sources.add(r.source)
    if (r.region) regions.add(r.region)
    if (r.country) countries.add(r.country)
  }
  const { data: campaignRows } = await admin.from('campaigns').select('id, name').order('created_at', { ascending: false }).limit(100)
  const geo: Record<string, Record<string, string[]>> = {}
  Array.from(geoMap.entries()).forEach(([c, regionsOf]) => {
    geo[c] = {}
    Array.from(regionsOf.entries()).forEach(([g, communesOf]) => { geo[c][g] = Array.from(communesOf).sort((a, b) => a.localeCompare(b, 'es')) })
  })
  return {
    geo,
    communes: Array.from(communes).sort(), sources: Array.from(sources).sort(),
    regions: Array.from(regions).sort(), countries: Array.from(countries).sort(),
    campaigns: (campaignRows ?? []) as Array<{ id: string; name: string }>,
  }
})

// Suscripción: baja/rebote/queja (email_optouts, misma fuente que el envío masivo) manda sobre el consentimiento.
function subscriptionOf(lead: { email?: string | null; marketing_consent?: boolean | null }, optouts: Map<string, string | null>) {
  const reason = lead.email ? optouts.get(normalizeEmail(lead.email)) : undefined
  if (reason !== undefined) return reason === 'bounce' || reason === 'complaint' ? 'blocked' : 'unsubscribed'
  if (!lead.email) return 'no_email'
  return lead.marketing_consent === true ? 'subscribed' : 'unconfirmed'
}

// Tipo: mismo criterio que el filtro «Tipo» (sufijo del origen o marca vinculada).
function leadTypeOf(lead: { source?: string | null; converted_brand_id?: string | null }) {
  if (lead.source?.endsWith('_influencer')) return 'influencer'
  if (lead.source?.endsWith('_cliente')) return 'customer'
  if (lead.converted_brand_id) return 'brand'
  return 'other'
}

// Columnas ordenables (lista cerrada: nunca se interpola texto del cliente en el orden).
const SORTABLE = ['company_name', 'contact_rut', 'email', 'instagram', 'country', 'region', 'commune', 'industry', 'source', 'qualification_status', 'contacted_at', 'created_at']

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
  const source = searchParams.get('source') ?? ''
  const industry = searchParams.get('industry') ?? ''
  const communesFilter = searchParams.getAll('commune').filter(Boolean)
  const emailStatus = searchParams.get('email_status') ?? ''
  const contactData = searchParams.get('contact_data') ?? ''
  const extra: ExtraFilters = {
    type: searchParams.get('type') ?? '', country: searchParams.get('country') ?? '', region: searchParams.get('region') ?? '',
    registration: searchParams.get('registration') ?? '', subscription: searchParams.get('subscription') ?? '',
  }
  const activityDays = parseInt(searchParams.get('activity') ?? '', 10)
  const campaignFilter = searchParams.get('campaign') ?? ''
  const idsOnly = searchParams.get('ids_only') === '1'
  const sortCol = SORTABLE.includes(searchParams.get('sort') ?? '') ? (searchParams.get('sort') as string) : 'created_at'
  const orderDefaultDesc = searchParams.get('sort') === 'priority'
  const ascending = !orderDefaultDesc && searchParams.get('order') === 'asc'
  // Orden por defecto: Chile primero, el resto después y Estados Unidos al final (solo sin elegir país ni columna).
  const priority = searchParams.get('sort') === 'priority' && !(searchParams.get('country') ?? '')
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  const emailEventSets = await getEmailEventSets(admin).catch(error => {
    console.error('[GET /api/crm-leads email events]', error)
    return emptyEmailEventSets()
  })

  // Filtros por conjunto de ids (estado de email, actividad reciente, campaña): se intersectan.
  let eventLeadIds = getEmailEventLeadIds(emailStatus, emailEventSets)
  try {
    const sets: string[][] = []
    if (activityDays > 0) sets.push(await recentActivityLeadIds(admin, activityDays))
    if (campaignFilter) sets.push(await campaignLeadIds(admin, campaignFilter))
    for (const set of sets) {
      const keep = new Set(set)
      eventLeadIds = eventLeadIds === null ? set : eventLeadIds.filter(id => keep.has(id))
    }
  } catch (error) {
    console.error('[GET /api/crm-leads filtros por historial]', error)
    return NextResponse.json({ error: 'No se pudo aplicar el filtro de historial' }, { status: 500 })
  }
  const optouts = extra.subscription ? await getOptOuts(admin).catch(() => []) : []

  // ── ids_only: trae TODOS los ids que cumplen el filtro (no solo la página
  // actual) — usado por "Seleccionar todos los que cumplen el filtro" en el
  // CRM. Reusa los mismos filtros que el listado paginado. Corta antes de
  // hacer el enriquecimiento (auth map, sources, etc.) que no se necesita acá.
  if (idsOnly) {
    const buildIdsQuery = (eventLeadIds?: string[]) => {
      let q: any = admin.from('crm_leads').select('id').order('created_at', { ascending: false })
      q = q.neq('qualification_status', 'converted') // registrados en SCENCE salen del CRM (su historial se conserva)
      if (qualification) q = q.eq('qualification_status', qualification)
      if (source) q = q.eq('source', source)
      if (industry) q = q.eq('industry', industry)
      if (communesFilter.length) q = q.in('commune', communesFilter)
      q = applyContactDataFilter(q, contactData)
      q = applyExtraFilters(q, extra, optouts)
      if (eventLeadIds) q = q.in('id', eventLeadIds)
      if (emailStatus === 'not_sent') q = q.is('contacted_at', null)
      if (search) q = q.or(searchFilter(search))
      return q
    }

    const allIds = new Set<string>()
    const PAGE = 1000
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
        if (rows.length < PAGE || allIds.size >= 50000) break
        from += PAGE
      }
      if (allIds.size >= 50000) break
    }

    return NextResponse.json({ ids: Array.from(allIds).slice(0, 50000) })
  }

  // Auth map y catálogo no dependen de la página: se piden en paralelo con la query de leads (y con caché).
  const authMapPromise = getAuthEmailMap(admin)
  const catalogPromise = getLeadCatalog(admin)

  const leadFields = 'id, contact_name, company_name, email, phone_1, instagram, contact_rut, commune, region, country, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at, marketing_consent, converted_brand_id'
  // Tramos de la prioridad por país: 0 = Chile, 1 = otros (y sin país), 2 = Estados Unidos.
  const SEGMENTS: Array<(q: any) => any> = [
    q => q.eq('country', 'Chile'),
    q => q.is('country', null),
    q => q.not('country', 'in', '("Chile","Estados Unidos")'),
    q => q.eq('country', 'Estados Unidos'),
  ]
  const countryRank = (c: string | null | undefined) => (c === 'Chile' ? 0 : c === 'Estados Unidos' ? 3 : c ? 2 : 1)
  const buildLeadsQuery = (eventLeadIds?: string[], withCount = false, segment?: number, head = false) => {
    let q: any = withCount
      ? admin.from('crm_leads').select(leadFields, { count: 'exact', head })
      : admin.from('crm_leads').select(leadFields)
    if (segment !== undefined) q = SEGMENTS[segment](q)
    q = q.order(sortCol, { ascending, nullsFirst: false }).order('id', { ascending: true })
    q = q.neq('qualification_status', 'converted') // registrados en SCENCE salen del CRM (su historial se conserva)
    if (qualification) q = q.eq('qualification_status', qualification)
    if (source) q = q.eq('source', source)
    if (industry) q = q.eq('industry', industry)
    if (communesFilter.length) q = q.in('commune', communesFilter)
    q = applyContactDataFilter(q, contactData)
    q = applyExtraFilters(q, extra, optouts)
    if (eventLeadIds) q = q.in('id', eventLeadIds)
    if (emailStatus === 'not_sent') q = q.is('contacted_at', null)
    if (search) q = q.or(searchFilter(search))
    return q
  }

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
    const matching = Array.from(matchingById.values()).sort((a, b) => {
      if (priority && countryRank(a.country) !== countryRank(b.country)) return countryRank(a.country) - countryRank(b.country)
      const av = String(a[sortCol] ?? ''), bv = String(b[sortCol] ?? '')
      if (!a[sortCol] !== !b[sortCol]) return a[sortCol] ? -1 : 1 // vacíos al final
      return (ascending ? 1 : -1) * av.localeCompare(bv, 'es') || a.id.localeCompare(b.id)
    })
    count = matching.length
    data = matching.slice((page - 1) * limit, page * limit)
  } else if (priority) {
    // Chile → otros → Estados Unidos: la página se arma con los tramos que le corresponden (orden por fecha dentro de cada uno).
    const heads = await Promise.all(SEGMENTS.map((_, i) => buildLeadsQuery(undefined, true, i, true)))
    const failed = heads.find((h: any) => h.error)
    if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 })
    const counts: number[] = heads.map((h: any) => h.count ?? 0)
    const start = (page - 1) * limit, end = start + limit
    let offset = 0
    for (let i = 0; i < SEGMENTS.length; i++) {
      const from = Math.max(start, offset), to = Math.min(end, offset + counts[i])
      if (to > from) {
        const { data: rows, error } = await buildLeadsQuery(undefined, false, i).range(from - offset, to - offset - 1)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        data.push(...(rows ?? []))
      }
      offset += counts[i]
    }
    count = offset
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

  const allOptOuts = await getOptOuts(admin).catch(() => [] as Array<{ email: string; reason: string | null }>)
  const optoutByEmail = new Map(allOptOuts.map(o => [normalizeEmail(o.email), o.reason]))
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
      subscription: subscriptionOf(l, optoutByEmail),
      lead_type: leadTypeOf(l),
    }
  })

  const { geo, communes, sources, regions, countries, campaigns } = await catalogPromise.catch(error => {
    console.error('[GET /api/crm-leads catalog]', error)
    return { geo: {} as Record<string, Record<string, string[]>>, communes: [] as string[], sources: [] as string[], regions: [] as string[], countries: [] as string[], campaigns: [] as Array<{ id: string; name: string }> }
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

  return NextResponse.json({ data: enriched, total: count, page, limit, geo, communes, sources, regions, countries, campaigns, stats })
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
  const country = typeof body.country === 'string' ? body.country.trim() : ''
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

  // País y región solo del catálogo `locations` (lo que no exista allí no se guarda).
  const loc = await normalizeLeadLocation(admin, { country, region })
  const { data: lead, error } = await admin
    .from('crm_leads')
    .insert({
      company_name: companyName || null,
      contact_name: contactName || null,
      email: email || null,
      phone_1: phone1 || null,
      instagram: instagram || null,
      commune: await canonicalCommune(admin, commune),
      region: loc.region,
      country: loc.country,
      industry: industry || null,
      source,
      qualification_status: 'unqualified',
      imported_at: new Date().toISOString(),
    })
    .select('id, contact_name, company_name, email, phone_1, instagram, commune, region, country, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at')
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
