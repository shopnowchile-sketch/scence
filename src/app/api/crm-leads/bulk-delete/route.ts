import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const leadIds = Array.isArray(body.lead_ids)
    ? body.lead_ids.filter((id: unknown) => typeof id === 'string' && id.length > 0)
    : []

  const uniqueIds = Array.from(new Set(leadIds))

  if (uniqueIds.length === 0) {
    return NextResponse.json({ error: 'No hay leads seleccionados' }, { status: 422 })
  }

  if (uniqueIds.length > 20000) {
    return NextResponse.json({ error: 'Máximo 20.000 leads por eliminación' }, { status: 422 })
  }

  // Con miles de ids, mandarlos todos en un solo .in(...) puede superar el
  // límite de largo de URL de PostgREST — se hace en tandas chicas (esto es
  // borrado puro en la BD, sin llamadas externas, así que es rápido y no
  // necesita background job como el envío masivo de emails).
  const CHUNK = 300
  let deleted = 0

  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK)

    const { data, error } = await admin
      .from('crm_leads')
      .delete()
      .in('id', chunk)
      .select('id')

    if (error) {
      console.error('[DELETE /api/crm-leads/bulk-delete]', error)
      return NextResponse.json({ error: error.message, deleted }, { status: 500 })
    }

    deleted += data?.length ?? 0
  }

  return NextResponse.json({
    deleted,
    requested: uniqueIds.length,
  })
}
