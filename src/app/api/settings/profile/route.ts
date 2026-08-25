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

  const { full_name, display_name, phone, timezone, locale, avatar_url, notification_preferences, signer_rut, signer_role } = body

  if (locale !== undefined && locale !== 'es' && locale !== 'en') {
    return NextResponse.json({ error: 'Unsupported locale' }, { status: 400 })
  }

  const admin = createAdminClient()

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)
  if (has('full_name')) update.full_name = full_name
  if (has('display_name')) update.display_name = display_name
  if (has('phone')) update.phone = phone ?? null
  if (has('timezone')) update.timezone = timezone
  if (has('locale')) update.locale = locale
  if (has('avatar_url')) update.avatar_url = avatar_url ?? null
  if (has('signer_rut')) update.signer_rut = signer_rut ?? null
  if (has('signer_role')) update.signer_role = signer_role ?? null

  // Preferencias de notificación: se guardan dentro de metadata (JSONB) para
  // no crear una columna/tabla nueva. Merge con lo existente, nunca se pisa
  // el resto de metadata.
  if (notification_preferences && typeof notification_preferences === 'object') {
    const { data: current } = await admin.from('profiles').select('metadata').eq('id', user.id).maybeSingle()
    const currentMeta = (current?.metadata as Record<string, unknown> | null) ?? {}
    update.metadata = { ...currentMeta, notification_preferences }
  }

  const { data, error } = await admin
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select()
    .single()

  if (error) { console.error('[PATCH /api/settings/profile]', error); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ data })
}
