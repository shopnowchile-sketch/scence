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
  const sources = Array.from(sourcesSet).sort()

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit, sources })
}
