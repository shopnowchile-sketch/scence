import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
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

  if (uniqueIds.length > 100) {
    return NextResponse.json({ error: 'Máximo 100 leads por eliminación' }, { status: 422 })
  }

  await admin.from('crm_email_events').delete().in('lead_id', uniqueIds)
  await admin.from('crm_lead_activities').delete().in('lead_id', uniqueIds)

  const { data, error } = await admin
    .from('crm_leads')
    .delete()
    .in('id', uniqueIds)
    .select('id')

  if (error) {
    console.error('[DELETE /api/crm-leads/bulk-delete]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    deleted: data?.length ?? 0,
    requested: uniqueIds.length,
  })
}
