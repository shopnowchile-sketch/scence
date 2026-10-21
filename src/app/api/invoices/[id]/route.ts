import { NextRequest, NextResponse } from 'next/server'
import { getResend, FROM_EMAIL, invoiceEmail } from '@/lib/resend'
import { formatDate } from '@/lib/utils'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess, type BrandPermission } from '@/lib/supabase/ensureOrg'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { planInvoicePatch, MUTABLE_INVOICE_STATUSES } from '@/lib/invoice-patch-policy'

type Params = { params: { id: string } }

async function canAccessInvoice(userId: string, organizationId: string, permission: BrandPermission) {
  const admin = createAdminClient()
  const orgId = await getOrgId(userId, undefined, admin)
  const platformRole = orgId ? await getUserRole(userId, orgId, admin) : null
  if (platformRole?.isAdmin) return true
  const access = await resolveBrandAccess(userId)
  return access?.organizationId === organizationId && hasBrandPermission(access, permission)
}

async function isInvoicePlatformAdmin(userId: string) {
  const admin = createAdminClient()
  const orgId = await getOrgId(userId, undefined, admin)
  const platformRole = orgId ? await getUserRole(userId, orgId, admin) : null
  return !!platformRole?.isAdmin
}

// ── GET /api/invoices/[id] ────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select(`*, campaign:campaigns (id, name), items:invoice_line_items (*)`)
    .eq('id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[GET /api/invoices/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!(await canAccessInvoice(user.id, data.organization_id, 'billing.read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Normalize: extract client_* from metadata
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {}
  const normalized = data ? {
    ...data,
    client_name:    meta.client_name    ?? data.invoice_number ?? '',
    client_email:   meta.client_email   ?? null,
    client_address: meta.client_address ?? null,
    client_tax_id:  meta.client_tax_id  ?? null,
  } : null

  return NextResponse.json({ data: normalized })
}

// ── PATCH /api/invoices/[id] — status transitions ─────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Fetch invoice for email context
  const { data: invoiceData } = await admin
    .from('invoices')
    .select('*, organization_id')
    .eq('id', params.id)
    .single()
  const invoiceMeta = (invoiceData?.metadata as Record<string,unknown> ?? {})
  if (!invoiceData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canAccessInvoice(user.id, invoiceData.organization_id, 'billing.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const invoice = {
    ...(invoiceData ?? {}),
    client_name:    String(invoiceMeta.client_name ?? invoiceData?.invoice_number ?? ''),
    client_email:   invoiceMeta.client_email as string | null ?? null,
    invoice_number: invoiceData?.invoice_number ?? '',
    total:          invoiceData?.total ?? invoiceData?.gross_amount ?? 0,
    currency:       invoiceData?.currency ?? 'CLP',
    due_date:       invoiceData?.due_date ?? null,
    organization_id: invoiceData?.organization_id ?? '',
  }

  // Política de escritura (lista blanca por rol y estado): ver
  // src/lib/invoice-patch-policy.ts. Nada del body llega al update sin pasar por ahí.
  const plan = planInvoicePatch(body, {
    isAdmin: await isInvoicePlatformAdmin(user.id),
    currentStatus: String(invoiceData.status ?? ''),
    clientEmail: invoice.client_email,
    now,
  })
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status })

  const update = plan.update
  if (plan.kind === 'edit' && Object.keys(plan.metadataPatch).length) {
    // Merge de las 4 claves de cliente; kind/application_id/auto_generated se conservan.
    update.metadata = { ...invoiceMeta, ...plan.metadataPatch }
  }

  if (plan.kind === 'action' && plan.action === 'send') {
    // Send invoice email via Resend
    if (plan.sendTo) {
      try {
        const { data: orgData } = await admin
          .from('organizations').select('name').eq('id', invoice.organization_id).single()

        const resend = getResend()
        const { error: sendErr } = await resend.emails.send({
          from: FROM_EMAIL,
          to: plan.sendTo, tags: [emailAudience('brand')],
          subject: `Factura ${invoice.invoice_number} de ${orgData?.name ?? 'Scence'}`,
          html: invoiceEmail({
            clientName: invoice.client_name,
            invoiceNumber: invoice.invoice_number,
            total: invoice.total,
            currency: invoice.currency,
            dueDate: invoice.due_date ? formatDate(invoice.due_date) : null,
            orgName: orgData?.name ?? 'Scence',
            note: plan.note ?? undefined,
          }),
        })
        // Resend no lanza excepción en errores de API — hay que revisar `error`.
        if (sendErr) console.error('[invoice send email] Resend devolvió error:', sendErr)
      } catch(emailErr) {
        console.error('[invoice send email]', emailErr)
        // Email failed — still mark as sent (admin can resend)
      }
    }
  }

  // El estado actual se re-verifica en el propio UPDATE: dos acciones
  // concurrentes (p.ej. doble mark_paid) no se aplican dos veces.
  const { data, error } = await admin
    .from('invoices')
    .update(update)
    .eq('id', params.id)
    .in('status', MUTABLE_INVOICE_STATUSES as unknown as string[])
    .select('*, items:invoice_line_items(*)')
    .maybeSingle()

  if (error) {
    console.error('[PATCH /api/invoices/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'La factura cambió de estado mientras se procesaba. Recarga e inténtalo de nuevo.' }, { status: 409 })
  }

  // Confirmar una factura de colaboración activa automáticamente la relación
  // existente campaign_brands: recién aquí la marca aparece como participante.
  // La solicitud se valida contra ESTA factura (invoice_id), no solo contra
  // metadata, para que una factura no pueda activar la colaboración de otra.
  if (plan.kind === 'action' && plan.action === 'mark_paid' && invoiceMeta.kind === 'campaign_brand_collaboration' && typeof invoiceMeta.application_id === 'string') {
    const { data: application, error: appErr } = await admin.from('campaign_brand_applications')
      .select('id,campaign_id,brand_id').eq('id', invoiceMeta.application_id).eq('invoice_id', params.id).maybeSingle()
    if (appErr) {
      console.error('[PATCH /api/invoices/[id]] no se pudo leer la solicitud de colaboración:', appErr.message)
      return NextResponse.json({ error: 'La factura se marcó como pagada, pero no se pudo activar la colaboración. Reintenta desde la solicitud.' }, { status: 500 })
    }
    if (application) {
      const { error: activateErr } = await admin.from('campaign_brand_applications').update({ status: 'active', updated_at: now }).eq('id', application.id)
      const { error: linkErr } = await admin.from('campaign_brands').upsert({ campaign_id: application.campaign_id, brand_id: application.brand_id, role: 'collaborator', assigned_by: user.id }, { onConflict: 'campaign_id,brand_id' })
      if (activateErr || linkErr) {
        console.error('[PATCH /api/invoices/[id]] activación de colaboración incompleta:', activateErr?.message, linkErr?.message)
        return NextResponse.json({ error: 'La factura se marcó como pagada, pero la colaboración no se activó por completo. Revísala en la solicitud.' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ data })
}

// ── DELETE /api/invoices/[id] — only drafts ───────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }


  // Only allow deleting drafts
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('invoices')
    .select('status, organization_id')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canAccessInvoice(user.id, existing.organization_id, 'billing.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Solo se pueden eliminar facturas en borrador' }, { status: 409 })
  }

  const { error } = await admin.from('invoices').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
