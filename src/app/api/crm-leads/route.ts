import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// Módulo CRM — aislado, no toca brands/influencers/campaigns.
// Solo super_admin / brand_manager (mismo criterio que useIsAdmin / Sidebar admin).
async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

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

// ── GET /api/crm-leads — lista paginada con filtros ───────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const qualification = searchParams.get('qualification') ?? ''
  const region = searchParams.get('region') ?? ''
  const source = searchParams.get('source') ?? ''
  const industry = searchParams.get('industry') ?? ''
  const commune = searchParams.get('commune') ?? ''
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  let query = admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, phone_1, commune, region, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (qualification) query = query.eq('qualification_status', qualification)
  if (region) query = query.eq('region', region)
  if (source) query = query.eq('source', source)
  if (industry) query = query.eq('industry', industry)
  if (commune) query = query.eq('commune', commune)
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data, error, count } = await query
  if (error) {
    console.error('[GET /api/crm-leads]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const authMap = await buildAuthEmailMap(admin)
  const enriched = (data ?? []).map(l => {
    const lastSignIn = l.email ? authMap.get(l.email.toLowerCase()) ?? null : null
    return { ...l, app_connected: authMap.has((l.email ?? '').toLowerCase()), app_last_sign_in_at: lastSignIn }
  })

  // Valores distintos de `source` (para poblar el filtro "Origen" en la UI) —
  // se calcula junto con la lista para no necesitar un endpoint nuevo.
  // FIX (2026-07-05): un solo `.limit(20000)` NO bastaba — Supabase/PostgREST
  // corta cada request a ~1000 filas server-side sin importar el límite
  // pedido del lado del cliente (mismo bug ya encontrado y corregido en
  // notify-no-instagram/route.ts). Con 2 tandas importadas en orden distinto
  // (maturana_enero_2027 primero, 4733 filas; cuicos_las_condes_wengerhaus
  // después, 1000 filas), la query sin paginar solo veía la primera tanda y
  // "cuicos" nunca aparecía en el filtro. Se pagina con el mismo patrón
  // PAGE=1000 + loop que ya usa loadScan/notify-no-instagram.
  const sourcesSet = new Set<string>()
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data: sourceRows } = await admin.from('crm_leads').select('source').range(from, from + PAGE - 1)
      if (!sourceRows || sourceRows.length === 0) break
      for (const r of sourceRows) if (r.source) sourcesSet.add(r.source)
      if (sourceRows.length < PAGE) break
      from += PAGE
    }
  }
  const industriesSet = new Set<string>()
  const communesSet = new Set<string>()
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data: filterRows } = await admin
        .from('crm_leads')
        .select('industry, commune')
        .range(from, from + PAGE - 1)

      if (!filterRows || filterRows.length === 0) break

      for (const r of filterRows) {
        if (r.industry) industriesSet.add(r.industry)
        if (r.commune) communesSet.add(r.commune)
      }

      if (filterRows.length < PAGE) break
      from += PAGE
    }
  }

  const sources = Array.from(sourcesSet).sort()
  const industries = Array.from(industriesSet).sort()
  const communes = Array.from(communesSet).sort()

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit, sources, industries, communes })
}

// ── POST /api/crm-leads — crear lead manual ──────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  const companyName = typeof body.company_name === 'string' ? body.company_name.trim() : ''
  const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone1 = typeof body.phone_1 === 'string' ? body.phone_1.trim() : ''
  const commune = typeof body.commune === 'string' ? body.commune.trim() : ''
  const region = typeof body.region === 'string' ? body.region.trim() : ''
  const industry = typeof body.industry === 'string' ? body.industry.trim() : ''
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual'

  if (!companyName && !email) {
    return NextResponse.json({ error: 'Debes ingresar al menos empresa o email' }, { status: 422 })
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
      commune: commune || null,
      region: region || null,
      industry: industry || null,
      source,
      qualification_status: 'unqualified',
      imported_at: new Date().toISOString(),
    })
    .select('id, contact_name, company_name, email, phone_1, commune, region, industry, company_size, employee_count, qualification_status, contacted_at, created_at, source, imported_at')
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
