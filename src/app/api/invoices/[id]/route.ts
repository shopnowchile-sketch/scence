import { NextRequest, NextResponse } from 'next/server'
import { getResend, FROM_EMAIL, invoiceEmail } from '@/lib/resend'
import { formatDate } from '@/lib/utils'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

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
  const { action, send_to, note, ...fields } = body as Record<string, unknown>
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { ...fields, updated_at: now }

  // Fetch invoice for email context
  const { data: invoiceData } = await admin
    .from('invoices')
    .select('*, organization_id')
    .eq('id', params.id)
    .single()
  const invoiceMeta = (invoiceData?.metadata as Record<string,unknown> ?? {})
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

  switch (action) {
    case 'send': {
      update.status = 'sent'
      // Send invoice email via Resend
      if (send_to || invoice.client_email) {
        try {
          // Get org name
          const { data: orgData } = await admin
            .from('organizations').select('name').eq('id', invoice.organization_id).single()
          
          const resend = getResend()
          await resend.emails.send({
            from: FROM_EMAIL,
            to: String(send_to || invoice.client_email),
            subject: `Factura ${invoice.invoice_number} de ${orgData?.name ?? 'Scence'}`,
            html: invoiceEmail({
              clientName: invoice.client_name,
              invoiceNumber: invoice.invoice_number,
              total: invoice.total,
              currency: invoice.currency,
              dueDate: invoice.due_date ? formatDate(invoice.due_date) : null,
              orgName: orgData?.name ?? 'Scence',
              note: note ? String(note) : undefined,
            }),
          })
        } catch(emailErr) {
          console.error('[invoice send email]', emailErr)
          // Email failed — still mark as sent (admin can resend)
        }
      }
      break
    }
    case 'mark_paid':
      update.status = 'paid'
      update.paid_at = now
      if (fields.payment_reference) update.payment_reference = fields.payment_reference
      break
    case 'void':
      update.status = 'void'
      break
    case 'mark_overdue':
      update.status = 'overdue'
      break
    // Generic field update (no action)
  }

  const { data, error } = await admin
    .from('invoices')
    .update(update)
    .eq('id', params.id)
    .select('*, items:invoice_line_items(*)')
    .single()

  if (error) {
    console.error('[PATCH /api/invoices/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
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
    .select('status')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Solo se pueden eliminar facturas en borrador' }, { status: 409 })
  }

  const { error } = await admin.from('invoices').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
