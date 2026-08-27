import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'

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
  const search = searchParams.get('search')?.trim() ?? ''
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

  const emailEventSets: EmailEventSets = {
    sent: new Set<string>(),
    delivered: new Set<string>(),
    opened: new Set<string>(),
    clicked: new Set<string>(),
    failed: new Set<string>(),
    bounced: new Set<string>(),
  }

  {
    const PAGE = 1000
    let from = 0

    for (;;) {
      const { data: rows } = await admin
        .from('crm_email_events')
        .select('lead_id, event_type')
        .not('lead_id', 'is', null)
        .range(from, from + PAGE - 1)

      if (!rows || rows.length === 0) break

      for (const row of rows as Array<{ lead_id: string | null; event_type: string | null }>) {
        if (!row.lead_id || !row.event_type) continue
        if (row.event_type === 'email.sent') emailEventSets.sent.add(row.lead_id)
        if (row.event_type === 'email.delivered') emailEventSets.delivered.add(row.lead_id)
        if (row.event_type === 'email.opened') emailEventSets.opened.add(row.lead_id)
        if (row.event_type === 'email.clicked') emailEventSets.clicked.add(row.lead_id)
        if (row.event_type === 'email.failed') emailEventSets.failed.add(row.lead_id)
        if (row.event_type === 'email.bounced') emailEventSets.bounced.add(row.lead_id)
      }

      if (rows.length < PAGE) break
      from += PAGE
    }
  }

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
      if (search) q = q.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,instagram.ilike.%${search}%`)
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
    if (search) q = q.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%,instagram.ilike.%${search}%`)
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

  const authMap = await buildAuthEmailMap(admin)

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

  // La única dimensión de catálogo que sigue visible en el toolbar es comuna.
  // Se pagina para no perder valores por el límite de filas de PostgREST.
  const communesSet = new Set<string>()
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data: filterRows } = await admin
        .from('crm_leads')
        .select('commune')
        .range(from, from + PAGE - 1)

      if (!filterRows || filterRows.length === 0) break

      for (const r of filterRows) {
        if (r.commune) communesSet.add(r.commune)
      }

      if (filterRows.length < PAGE) break
      from += PAGE
    }
  }

  const communes = Array.from(communesSet).sort()

  const stats = {
    sent: emailEventSets.sent.size,
    delivered: emailEventSets.delivered.size,
    opened: emailEventSets.opened.size,
    clicked: emailEventSets.clicked.size,
    failed: emailEventSets.failed.size,
    bounced: emailEventSets.bounced.size,
    openRate: emailEventSets.sent.size > 0 ? Math.round((emailEventSets.opened.size / emailEventSets.sent.size) * 100) : 0,
  }

  return NextResponse.json({ data: enriched, total: count, page, limit, communes, stats })
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
