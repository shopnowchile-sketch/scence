import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/contracts/[id] ──────────────────────────────────────────────────
// Lectura de un contrato ya generado, siempre acotada a la organización del
// Admin que consulta (misma fuente de autorización que el resto: getUserRole
// vía organization_members, nunca profiles.role).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  if (!role?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('contracts')
    .select('id, title, status, content, party_type, brand_id, campaign_id, template_id, total_value, currency, start_date, end_date, created_at, metadata, brand:brands!brand_id(name)')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    console.error('[GET /api/contracts/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data })
}
