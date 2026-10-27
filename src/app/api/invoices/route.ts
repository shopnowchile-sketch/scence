import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, hasBrandPermission } from '@/lib/supabase/ensureOrg'
import { resolveInvoiceActor } from '@/lib/invoice-authorize'
import { redactInvoiceForShare } from '@/lib/invoice-access'

// Propiedad: invoices.owner_brand_id (NO organization_id ni brand_id; ver
// src/lib/invoice-access.ts). SCENCE ve todo; una marca solo ve las suyas y, con
// scope=shared, las compartidas con ella (solo lectura, nunca mezcladas con las propias).

const clampInt = (raw: string | null, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// ── GET /api/invoices ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status     = searchParams.get('status')
  const campaignId = searchParams.get('campaign_id')
  const search     = searchParams.get('search')
  const dateFrom   = searchParams.get('date_from')
  const dateTo     = searchParams.get('date_to')
  const scope      = searchParams.get('scope') === 'shared' ? 'shared' : 'own'
  const page       = clampInt(searchParams.get('page'), 1, 1, 100000)
  const limit      = clampInt(searchParams.get('limit'), 50, 1, 10000)

  const admin = createAdminClient()
  const actor = await resolveInvoiceActor(user.id, admin)
  const brand = actor.brand
  if (!actor.isPlatformAdmin && !hasBrandPermission(brand, 'billing.read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let query = admin
    .from('invoices')
    .select(`
      *,
      campaign:campaigns (id, name),
      items:invoice_line_items (*)
    `, { count: 'exact' })
    .order('issue_date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  let access: 'admin' | 'owner' | 'shared' = 'admin'
  if (!actor.isPlatformAdmin) {
    if (scope === 'shared') {
      access = 'shared'
      const { data: shares, error: sharesError } = await admin
        .from('invoice_shares').select('invoice_id')
        .eq('brand_id', brand!.brandId).eq('status', 'active')
      if (sharesError) {
        console.error('[GET /api/invoices] shares', sharesError)
        return NextResponse.json({ error: 'No se pudieron leer las facturas compartidas' }, { status: 500 })
      }
      const ids = (shares ?? []).map(s => s.invoice_id as string)
      if (ids.length === 0) return NextResponse.json({ data: [], total: 0, page, limit })
      // El trigger invoice_shares_validate impide compartir una factura con su propia
      // marca propietaria; las facturas de SCENCE (owner_brand_id NULL) sí se comparten.
      query = query.in('id', ids)
    } else {
      access = 'owner'
      query = query.eq('owner_brand_id', brand!.brandId)
    }
  }
  if (campaignId) query = query.eq('campaign_id', campaignId)
  if (status)  query = query.eq('status', status)
  if (dateFrom) query = query.gte('issue_date', dateFrom)
  if (dateTo)   query = query.lte('issue_date', dateTo)
  if (search)   query = query.ilike('invoice_number', `%${search}%`)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/invoices]', error)
    return NextResponse.json({ error: 'No se pudieron leer las facturas' }, { status: 500 })
  }

  // Normalize: extract client_* from metadata for backward compat
  type InvRow = Record<string, unknown>
  const normalized = (data ?? []).map((inv: InvRow) => {
    const meta = (inv.metadata as Record<string, unknown> | null) ?? {}
    const row = {
      ...inv,
      client_name:    meta.client_name    ?? inv.invoice_number ?? '',
      client_email:   meta.client_email   ?? null,
      client_address: meta.client_address ?? null,
      client_tax_id:  meta.client_tax_id  ?? null,
      access,
      read_only: access === 'shared',
    }
    return access === 'shared' ? redactInvoiceForShare(row) : row
  })

  return NextResponse.json({ data: normalized, total: count ?? 0, page, limit })
}

// ── POST /api/invoices ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    campaign_id,
    client_name,
    client_email,
    client_address,
    client_tax_id,
    issue_date,
    due_date,
    currency = 'CLP',
    tax_rate = 0,
    notes,
    items = [],
    organization_id,
  } = body as Record<string, unknown>

  if (!client_name || !issue_date || !due_date) {
    return NextResponse.json(
      { error: 'client_name, issue_date and due_date are required' },
      { status: 422 }
    )
  }

  const admin = createAdminClient()
  const actor = await resolveInvoiceActor(user.id, admin)
  const brandAccess = actor.brand
  if (!actor.isPlatformAdmin && !hasBrandPermission(brandAccess, 'billing.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // La propiedad se deriva SIEMPRE de la identidad verificada en servidor. Una marca
  // no puede nombrar propietario, receptora ni organización por el payload.
  if (!actor.isPlatformAdmin) {
    const forged =
      (body.owner_brand_id != null && body.owner_brand_id !== brandAccess!.brandId) ||
      (body.brand_id != null && body.brand_id !== brandAccess!.brandId) ||
      (organization_id != null && organization_id !== brandAccess!.organizationId)
    if (forged) {
      return NextResponse.json({ error: 'No puedes asignar la propiedad de la factura a otra marca u organización' }, { status: 403 })
    }
  }

  let orgId: string | null = actor.isPlatformAdmin
    ? ((organization_id as string) ?? await getOrgId(user.id, user.user_metadata, admin))
    : brandAccess!.organizationId

  if (campaign_id) {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, organization_id, brand_id, created_by_brand_id')
      .eq('id', String(campaign_id))
      .maybeSingle()
    if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

    if (!actor.isPlatformAdmin) {
      const ownsCampaign = !!brandAccess && (
        campaign.brand_id === brandAccess.brandId || campaign.created_by_brand_id === brandAccess.brandId
      )
      if (!ownsCampaign) return NextResponse.json({ error: 'No tienes permiso para facturar esta campaña' }, { status: 403 })
    } else {
      orgId = campaign.organization_id
    }
  } else if (!actor.isPlatformAdmin) {
    return NextResponse.json({ error: 'La marca debe asociar la factura a una campaña propia' }, { status: 422 })
  }

  if (!orgId) return NextResponse.json({ error: 'Organización no encontrada' }, { status: 422 })

  // Controles financieros: cantidades, precios e impuesto deben ser números válidos.
  const rate = Number(tax_rate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json({ error: 'tax_rate debe estar entre 0 y 100' }, { status: 422 })
  }
  if (!Array.isArray(items)) return NextResponse.json({ error: 'items debe ser una lista' }, { status: 422 })
  const itemsArr: Array<{ description?: unknown; quantity: number; unit_price: number }> = []
  for (const raw of items as Array<Record<string, unknown>>) {
    const quantity = raw?.quantity === undefined ? 1 : Number(raw.quantity)
    const unitPrice = raw?.unit_price === undefined ? 0 : Number(raw.unit_price)
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'Cantidad y precio de cada ítem deben ser números mayores o iguales a 0' }, { status: 422 })
    }
    itemsArr.push({ description: raw?.description, quantity, unit_price: unitPrice })
  }
  const subtotal = itemsArr.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const taxAmount = subtotal * (rate / 100)
  const total = subtotal + taxAmount

  // Create invoice (invoice_number auto-generated by DB trigger)
  // client_* columns don't exist in DB schema — store in metadata JSONB
  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .insert({
      organization_id: orgId,
      // Propietaria = la marca autenticada. NULL = emitida por SCENCE (solo admin).
      owner_brand_id: actor.isPlatformAdmin ? null : brandAccess!.brandId,
      campaign_id: campaign_id ?? null,
      issue_date,
      due_date,
      currency,
      subtotal,
      tax_rate: rate,
      tax_amount: taxAmount,
      total,
      status: 'draft',
      notes: notes ?? null,
      issued_by: user.id,  // correct column name
      metadata: {
        client_name:    client_name ?? null,
        client_email:   client_email ?? null,
        client_address: client_address ?? null,
        client_tax_id:  client_tax_id ?? null,
      },
    })
    .select()
    .single()

  if (invErr) {
    console.error('[POST /api/invoices] invoice', invErr)
    return NextResponse.json({ error: 'No se pudo crear la factura' }, { status: 500 })
  }

  // Insert items if provided
  if (itemsArr.length > 0) {
    const { error: itemsErr } = await admin
      .from('invoice_line_items')
      .insert(
        itemsArr.map((item, idx) => ({
          invoice_id:  invoice.id,
          description: item.description ?? `Línea ${idx + 1}`,
          quantity:    item.quantity,
          unit_price:  item.unit_price,
          amount:      item.quantity * item.unit_price,  // correct column name
          currency:    currency as string ?? 'CLP',
        }))
      )

    if (itemsErr) {
      console.error('[POST /api/invoices] items', itemsErr)
      // Non-fatal — invoice exists, items failed
    }
  }

  // Fetch full invoice with items
  const { data } = await admin
    .from('invoices')
    .select('*, items:invoice_line_items(*)')
    .eq('id', invoice.id)
    .single()

  return NextResponse.json({ data }, { status: 201 })
}
