import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── GET /api/brands ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const sp     = req.nextUrl.searchParams
  const search = sp.get('search')
  const limit  = Number(sp.get('limit') ?? '100')

  let query = admin
    .from('brands')
    .select('*, campaigns:campaigns!brand_id(id, name, status, budget_total, currency)')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })
    .limit(limit)

  if (search) query = query.ilike('name', `%${search}%`)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/brands]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enriquecer con last_sign_in_at desde auth.users
  type BrandRow = Record<string, unknown> & { user_id?: string | null }
  const brands = (data ?? []) as BrandRow[]
  const userIds = brands.map(b => b.user_id).filter((id): id is string => !!id)
  const lastSeenMap: Record<string, string | null> = {}
  for (const uid of userIds) {
    const { data: u } = await admin.auth.admin.getUserById(uid)
    if (u?.user) lastSeenMap[uid] = u.user.last_sign_in_at ?? null
  }
  const enriched = brands.map(b => ({
    ...b,
    last_sign_in_at: b.user_id ? (lastSeenMap[b.user_id] ?? null) : null,
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0 })
}

// ── POST /api/brands ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, logo_url, website, industry, contact_name, contact_email, contact_phone, notes } = body

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 422 })

  const { data, error } = await admin
    .from('brands')
    .insert({
      organization_id: orgId,
      name,
      logo_url:      logo_url ?? null,
      website:       website ?? null,
      industry:      industry ?? null,
      contact_name:  contact_name ?? null,
      contact_email: contact_email ?? null,
      contact_phone: contact_phone ?? null,
      notes:         notes ?? null,
      created_by:    user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/brands]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
