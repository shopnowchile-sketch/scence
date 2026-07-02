import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// Módulo CRM — aislado, no toca brands/influencers/campaigns.
// Solo super_admin / brand_manager (mismo criterio que useIsAdmin / Sidebar admin).
async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
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
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  let query = admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, phone_1, commune, region, industry, company_size, employee_count, qualification_status, contacted_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (qualification) query = query.eq('qualification_status', qualification)
  if (region) query = query.eq('region', region)
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,contact_name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data, error, count } = await query
  if (error) {
    console.error('[GET /api/crm-leads]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit })
}
