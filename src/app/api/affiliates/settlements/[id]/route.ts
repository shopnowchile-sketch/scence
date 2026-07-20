import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }
const STATUSES = new Set(['pending', 'paid', 'problem'])

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('status' in body) {
    const status = String(body.status)
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 422 })
    }
    patch.status = status
    patch.paid_at = status === 'paid' ? new Date().toISOString() : null
  }
  if ('invoice_id' in body) patch.invoice_id = body.invoice_id || null
  if ('payroll_item_id' in body) patch.payroll_item_id = body.payroll_item_id || null
  if ('influencer_document_url' in body) {
    patch.influencer_document_url = body.influencer_document_url || null
  }
  if ('notes' in body) patch.notes = body.notes || null

  const { data, error } = await admin
    .from('commission_settlements')
    .update(patch)
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
