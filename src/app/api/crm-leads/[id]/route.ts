import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

const VALID_STATUS = ['unqualified', 'qualified', 'rejected', 'contacted', 'converted']

// ── GET /api/crm-leads/[id] — detalle + historial de actividad ────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: lead, error } = await admin
    .from('crm_leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })

  const { data: activities } = await admin
    .from('crm_lead_activities')
    .select('id, action_type, description, created_at, created_by')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ data: { ...lead, activities: activities ?? [] } })
}

// ── PATCH /api/crm-leads/[id] — actualizar calificación/notas ─────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.qualification_status !== undefined) {
    if (!VALID_STATUS.includes(body.qualification_status)) {
      return NextResponse.json({ error: 'qualification_status inválido' }, { status: 422 })
    }
    update.qualification_status = body.qualification_status
    if (body.qualification_status === 'qualified' || body.qualification_status === 'rejected') {
      update.qualified_at = new Date().toISOString()
    }
  }
  if (body.qualification_notes !== undefined) update.qualification_notes = body.qualification_notes

  const { data, error } = await admin
    .from('crm_leads')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (body.qualification_status) {
    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: body.qualification_status === 'qualified' ? 'qualified' : body.qualification_status === 'rejected' ? 'rejected' : 'note',
      description: `Estado cambiado a "${body.qualification_status}"`,
      created_by: user.id,
    })
  }

  return NextResponse.json({ data })
}
