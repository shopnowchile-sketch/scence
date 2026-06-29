import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// ── GET /api/settings/profile ─────────────────────────────────────────────────
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('[GET /api/settings/profile]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: { ...data, email: user.email } })
}

// ── PATCH /api/settings/profile ───────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { full_name, display_name, phone, timezone, locale, avatar_url } = body

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .update({
      full_name:    full_name    ?? undefined,
      display_name: display_name ?? undefined,
      phone:        phone        ?? null,
      timezone:     timezone     ?? undefined,
      locale:       locale       ?? undefined,
      avatar_url:   avatar_url   ?? null,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', user.id)
    .select()
    .single()

  if (error) { console.error('[PATCH /api/settings/profile]', error); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ data })
}
