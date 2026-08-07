import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Solo Admin puede aprobar solicitudes.' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { action?: string }
  const { data: application, error } = await admin.from('campaign_brand_applications')
    .select('*, campaign:campaigns(id,name,organization_id,currency,metadata), brand:brands(id,name,contact_email,contact_name,metadata)')
    .eq('id', params.id).single()
  if (error || !application) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (body.action === 'reject') {
    await admin.from('campaign_brand_applications').update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', application.id)
    return NextResponse.json({ success: true })
  }
  if (body.action !== 'approve_for_payment') return NextResponse.json({ error: 'Acción inválida' }, { status: 422 })
  const config = application.campaign?.metadata?.collaboration_opportunity ?? {}
  const total = Number(config.participation_value ?? 0)
  const brandMeta = application.brand?.metadata ?? {}
  const { data: invoice, error: invoiceError } = await admin.from('invoices').insert({
    organization_id: application.campaign.organization_id,
    campaign_id: application.campaign_id,
    brand_id: application.brand_id,
    issued_by: user.id,
    status: 'draft', subtotal: total, tax_rate: 0, tax_amount: 0, discount_amount: 0, total,
    currency: application.campaign.currency ?? 'CLP', issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    notes: `Participación como marca colaboradora en ${application.campaign.name}.`,
    metadata: { client_name: brandMeta.legal_name ?? application.brand.name, client_email: application.brand.contact_email, kind: 'campaign_brand_collaboration', application_id: application.id },
  }).select().single()
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 })
  await admin.from('campaign_brand_applications').update({ status: 'approved_for_payment', invoice_id: invoice.id, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', application.id)
  return NextResponse.json({ data: invoice })
}
