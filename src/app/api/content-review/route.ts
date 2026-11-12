import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

export const dynamic = 'force-dynamic'

// GET /api/content-review — entregables de contenido esperando revisión (mismo criterio que la tarjeta
// «Contenido por revisar» del dashboard: status in_review, sin asistencia). Solo Admin de plataforma.
// Aprobar y rechazar usan el PATCH ya existente de /api/campaigns/[id]/deliverables.
export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error, count } = await admin
    .from('campaign_deliverables')
    .select(`
      id, title, type, platform, due_date, content_url, published_url, submitted_at, submitted_notes, caption, campaign_id,
      influencer:influencers (id, user_name, avatar_url),
      campaign:campaigns (id, name, brand:brands!brand_id (name))
    `, { count: 'exact' })
    .eq('status', 'in_review')
    .neq('type', 'event_attendance')
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [], total: count ?? (data ?? []).length })
}
