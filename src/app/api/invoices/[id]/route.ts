import { NextRequest, NextResponse } from 'next/server'
import { getResend, FROM_EMAIL, invoiceEmail } from '@/lib/resend'
import { formatDate } from '@/lib/utils'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { planInvoicePatch, MUTABLE_INVOICE_STATUSES } from '@/lib/invoice-patch-policy'
import { authorizeInvoice, resolveInvoiceActor } from '@/lib/invoice-authorize'
import { redactInvoiceForShare } from '@/lib/invoice-access'

type Params = { params: { id: string } }

// Autorización por FACTURA (propiedad / acceso compartido), nunca por organization_id.
// Sin acceso → 404 (no revela si la factura existe). Con acceso de lectura pero sin
// permiso para la acción → 403.
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

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
    .maybeSingle()

  if (error) {
    console.error('[GET /api/invoices/[id]]', error)
    return NextResponse.json({ error: 'No se pudo leer la factura' }, { status: 500 })
  }
  if (!data) return NOT_FOUND()

  const actor = await resolveInvoiceActor(user.id, admin)
  const caps = await authorizeInvoice(admin, actor, { id: data.id, owner_brand_id: data.owner_brand_id ?? null })
  if (!caps.read) return NOT_FOUND()

  // Normalize: extract client_* from metadata
  const meta = (data.metadata as Record<string, unknown> | null) ?? {}
  const normalized = {
    ...data,
    client_name:    meta.client_name    ?? data.invoice_number ?? '',
    client_email:   meta.client_email   ?? null,
    client_address: meta.client_address ?? null,
    client_tax_id:  meta.client_tax_id  ?? null,
    access: caps.actor === 'platform_admin' ? 'admin' : caps.actor === 'owner_brand' ? 'owner' : 'shared',
    read_only: caps.actor === 'shared_brand',
  }

  return NextResponse.json({ data: caps.actor === 'shared_brand' ? redactInvoiceForShare(normalized) : normalized })
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Fetch invoice for email context
  const { data: invoiceData } = await admin
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (!invoiceData) return NOT_FOUND()
  const invoiceMeta = (invoiceData.metadata as Record<string,unknown> ?? {})

  const actor = await resolveInvoiceActor(user.id, admin)
  const caps = await authorizeInvoice(admin, actor, { id: invoiceData.id, owner_brand_id: invoiceData.owner_brand_id ?? null })
  if (!caps.read) return NOT_FOUND()

  const invoice = {
    ...invoiceData,
    client_name:    String(invoiceMeta.client_name ?? invoiceData.invoice_number ?? ''),
    client_email:   invoiceMeta.client_email as string | null ?? null,
    invoice_number: invoiceData.invoice_number ?? '',
    total:          invoiceData.total ?? invoiceData.gross_amount ?? 0,
    currency:       invoiceData.currency ?? 'CLP',
    due_date:       invoiceData.due_date ?? null,
    organization_id: invoiceData.organization_id ?? '',
  }

  // Política de escritura (lista blanca por capacidad y estado): ver
  // src/lib/invoice-patch-policy.ts. Nada del body llega al update sin pasar por ahí.
  const plan = planInvoicePatch(body, {
    caps,
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
  // concurrentes (p.ej. doble mark_paid) no se aplican dos veces. Una marca además
  // debe seguir siendo la propietaria en el momento de escribir.
  let updateQuery = admin
    .from('invoices')
    .update(update)
    .eq('id', params.id)
    .in('status', MUTABLE_INVOICE_STATUSES as unknown as string[])
  if (caps.actor === 'owner_brand') updateQuery = updateQuery.eq('owner_brand_id', invoiceData.owner_brand_id)
  const { data, error } = await updateQuery
    .select('*, items:invoice_line_items(*)')
    .maybeSingle()

  if (error) {
    console.error('[PATCH /api/invoices/[id]]', error)
    return NextResponse.json({ error: 'No se pudo actualizar la factura' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'La factura cambió de estado mientras se procesaba. Recarga e inténtalo de nuevo.' }, { status: 409 })
  }

  // Confirmar una factura de colaboración activa automáticamente la relación
  // existente campaign_brands: recién aquí la marca aparece como participante.
  // La solicitud se valida contra ESTA factura (invoice_id), no solo contra
  // metadata, para que una factura no pueda activar la colaboración de otra.
  // Solo el pago confirmado por SCENCE activa una colaboración.
  if (plan.kind === 'action' && plan.action === 'mark_paid' && caps.actor === 'platform_admin' && invoiceMeta.kind === 'campaign_brand_collaboration' && typeof invoiceMeta.application_id === 'string') {
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

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('invoices')
    .select('id, status, owner_brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!existing) return NOT_FOUND()
  const actor = await resolveInvoiceActor(user.id, admin)
  const caps = await authorizeInvoice(admin, actor, { id: existing.id, owner_brand_id: existing.owner_brand_id ?? null })
  if (!caps.read) return NOT_FOUND()
  if (!caps.delete) {
    return NextResponse.json({ error: 'No tienes permiso para eliminar esta factura' }, { status: 403 })
  }
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Solo se pueden eliminar facturas en borrador' }, { status: 409 })
  }

  // El borrado re-verifica el estado: una factura enviada entre la lectura y el
  // borrado no se elimina.
  const { data: deleted, error } = await admin
    .from('invoices').delete().eq('id', params.id).eq('status', 'draft').select('id')
  if (error) {
    console.error('[DELETE /api/invoices/[id]]', error)
    return NextResponse.json({ error: 'No se pudo eliminar la factura' }, { status: 500 })
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Solo se pueden eliminar facturas en borrador' }, { status: 409 })
  }

  return NextResponse.json({ success: true })
}
