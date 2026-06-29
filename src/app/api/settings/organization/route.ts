import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── GET /api/settings/organization ───────────────────────────────────────────
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  const { data, error } = await admin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── PATCH /api/settings/organization ─────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'No organization found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, website, industry, country, billing_email, currency, tax_id, logo_url } = body

  const { data, error } = await admin
    .from('organizations')
    .update({
      name:          name          ?? undefined,
      website:       website       ?? null,
      industry:      industry      ?? null,
      country:       country       ?? undefined,
      billing_email: billing_email ?? null,
      currency:      currency      ?? undefined,
      tax_id:        tax_id        ?? null,
      logo_url:      logo_url      ?? null,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', orgId)
    .select()
    .single()

  if (error) { console.error('[PATCH /api/settings/organization]', error); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ data })
}
