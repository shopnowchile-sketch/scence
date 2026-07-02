import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// GET /api/influencers/communes
// Lista de comunas distintas presentes en el roster (para poblar el filtro de
// "Comuna" en /admin-influencers) — separado del GET principal para no traer
// toda la tabla de influencers solo por esto.
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let query = admin
    .from('influencers')
    .select('commune')
    .not('commune', 'is', null)

  if (orgId) query = query.eq('organization_id', orgId)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/influencers/communes]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const communes = Array.from(new Set(
    (data ?? []).map(r => r.commune).filter((c): c is string => !!c && c.trim() !== '')
  )).sort((a, b) => a.localeCompare(b, 'es'))

  return NextResponse.json({ data: communes })
}
