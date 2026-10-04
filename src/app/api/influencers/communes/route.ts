import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { groupCommunes } from '@/lib/communes-chile'

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

  const { data: rows, error } = await admin
    .from('locations')
    .select('name')
    .eq('level', 'commune')
    .eq('is_active', true)
    .order('name')

  if (error) {
    console.error('[GET /api/influencers/communes]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fuente única: catálogo oficial de locations. variants se conserva
  // únicamente por compatibilidad con el componente de filtros mientras
  // migramos el GET principal a location_id.
  const communes = (rows ?? []).map(row => ({
    label: row.name,
    variants: [row.name],
  }))

  return NextResponse.json({ data: communes })
}
