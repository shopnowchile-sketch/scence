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

  // Agrupa por comuna real (mayúsculas/tildes/espacios distintos del mismo
  // valor) sin tocar la base — pedido de Pri 2026-07-13. `variants` trae
  // todos los valores crudos que existen hoy para esa comuna, para que el
  // filtro pueda seguir matcheando aunque el dato en `influencers.commune`
  // no esté normalizado todavía.
  const raw = (data ?? []).map(r => r.commune).filter((c): c is string => !!c && c.trim() !== '')
  const communes = groupCommunes(raw)

  return NextResponse.json({ data: communes })
}
