import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

// ── GET /api/payroll ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status   = searchParams.get('status')
  const search   = searchParams.get('search')
  const page     = parseInt(searchParams.get('page') ?? '1', 10)
  const limit    = parseInt(searchParams.get('limit') ?? '50', 10)

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  // Payroll: solo admins (super_admin, agency_manager, finance)
  const { isAdmin, role } = await getUserRole(user.id, orgId, admin)
  if (!isAdmin && role !== 'finance') {
    return NextResponse.json({ error: 'No tienes permisos para ver nóminas' }, { status: 403 })
  }

  let query = admin
    .from('payroll_runs')
    .select(`
      *,
      items:payroll_items (
        *,
        influencer:influencers (id, display_name, avatar_url, city, country)
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (orgId)  query = query.eq('organization_id', orgId)
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/payroll]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Normalize: map DB column 'title' → 'name', extract period from metadata
  // Also map payroll_items.gross_amount → amount for frontend compat
  type ItemRow = Record<string, unknown>
  type RunRow = Record<string, unknown>
  const normalized = (data ?? []).map((run: RunRow) => {
    const meta = (run.metadata as Record<string, unknown> | null) ?? {}
    const items = ((run.items as ItemRow[] | null) ?? []).map((item: ItemRow) => ({
      ...item,
      amount: item.gross_amount ?? item.net_amount ?? 0,
    }))
    return {
      ...run,
      name:         run.title,
      period_start: meta.period_start ?? null,
      period_end:   meta.period_end   ?? null,
      items,
    }
  })

  return NextResponse.json({ data: normalized, total: count ?? 0, page, limit })
}

// ── POST /api/payroll — create payroll run ────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const {
    name,
    period_start,
    period_end,
    currency = 'CLP',
    items = [],
    organization_id,
    notes,
  } = body as Record<string, unknown>

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 422 })
  }

  const admin = createAdminClient()
  const orgId = (organization_id as string) ?? await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { isAdmin, role: userRole } = await getUserRole(user.id, orgId, admin)
  if (!isAdmin && userRole !== 'finance') {
    return NextResponse.json({ error: 'No tienes permisos para crear nóminas' }, { status: 403 })
  }

  const itemsArr = items as Array<{ influencer_id: string; amount: number; description?: string }>
  const totalAmount = itemsArr.reduce((s, i) => s + (i.amount ?? 0), 0)

  // Create payroll run — schema uses 'title', no period_start/period_end (store in metadata)
  const { data: run, error: runErr } = await admin
    .from('payroll_runs')
    .insert({
      organization_id: orgId,
      title:           name as string,       // DB column is 'title'
      currency,
      total_amount:    totalAmount,
      status:          'pending',
      notes:           notes ?? null,
      created_by:      user.id,
      metadata:        { period_start, period_end },
    })
    .select()
    .single()

  if (runErr) {
    console.error('[POST /api/payroll] run', runErr)
    return NextResponse.json({ error: runErr.message }, { status: 500 })
  }

  // Insert items — schema uses gross_amount/net_amount, not amount
  if (itemsArr.length > 0) {
    await admin.from('payroll_items').insert(
      itemsArr.map(item => ({
        payroll_run_id: run.id,
        influencer_id:  item.influencer_id,
        gross_amount:   item.amount,
        net_amount:     item.amount,     // no tax deduction at creation time
        currency,
        description:    item.description ?? null,
        status:         'pending',
      }))
    )
  }

  const { data: runData } = await admin
    .from('payroll_runs')
    .select(`*, items:payroll_items(*, influencer:influencers(id, display_name, avatar_url))`)
    .eq('id', run.id)
    .single()

  const meta = ((runData as Record<string, unknown> | null)?.metadata as Record<string, unknown> | null) ?? {}
  const data = runData ? { ...runData, name: (runData as Record<string, unknown>).title, period_start: meta.period_start ?? null, period_end: meta.period_end ?? null } : null
  return NextResponse.json({ data }, { status: 201 })
}

// ── PATCH /api/payroll — approve or process a payroll run ─────────────────────
export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { run_id, action } = body as { run_id: string; action: string }
  if (!run_id || !action) {
    return NextResponse.json({ error: 'run_id and action are required' }, { status: 422 })
  }

  const now = new Date().toISOString()
  const admin = createAdminClient()

  const orgIdPatch = await getOrgId(user.id, user.user_metadata, admin)
  if (orgIdPatch) {
    const { isAdmin: isAdminPatch, role: rolePatch } = await getUserRole(user.id, orgIdPatch, admin)
    if (!isAdminPatch && rolePatch !== 'finance') {
      return NextResponse.json({ error: 'No tienes permisos para modificar nóminas' }, { status: 403 })
    }
  }

  const update: Record<string, unknown> = { updated_at: now }

  switch (action) {
    case 'approve':
      update.status = 'approved'
      update.approved_by = user.id
      update.approved_at = now
      break
    case 'process':
      update.status = 'processing'
      update.processed_at = now
      break
    case 'complete':
      update.status = 'paid'   // payroll_status enum: pending|approved|processing|paid|failed
      // Mark all items as paid
      await admin
        .from('payroll_items')
        .update({ status: 'paid', paid_at: now })
        .eq('payroll_run_id', run_id)
        .eq('status', 'pending')
      break
    case 'cancel':
      update.status = 'failed'  // closest valid enum value for cancellation
      break
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 422 })
  }

  const { data, error } = await admin
    .from('payroll_runs')
    .update(update)
    .eq('id', run_id)
    .select(`*, items:payroll_items(*, influencer:influencers(id, display_name, avatar_url))`)
    .single()

  if (error) {
    console.error('[PATCH /api/payroll]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
