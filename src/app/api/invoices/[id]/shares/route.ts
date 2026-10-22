import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { authorizeInvoice, resolveInvoiceActor } from '@/lib/invoice-authorize'
import { isUuid } from '@/lib/invoice-access'

// Acceso compartido de facturas (solo lectura). Lo gestiona la marca PROPIETARIA con
// permiso de facturación o el equipo SCENCE; una marca con acceso compartido NO puede
// compartir de nuevo (caps.share = false). Compartir no otorga edición ni pagos: eso lo
// impide decideInvoiceAccess, no esta tabla. Ver migración 20261022120000.

type Params = { params: { id: string } }

async function load(params: Params['params']) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const

  const admin = createAdminClient()
  const { data: invoice } = await admin
    .from('invoices').select('id, owner_brand_id').eq('id', params.id).maybeSingle()
  if (!invoice) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const

  const actor = await resolveInvoiceActor(user.id, admin)
  const caps = await authorizeInvoice(admin, actor, { id: invoice.id, owner_brand_id: invoice.owner_brand_id ?? null })
  if (!caps.read) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  if (!caps.share) return { response: NextResponse.json({ error: 'No tienes permiso para gestionar el acceso compartido de esta factura' }, { status: 403 }) } as const
  return { admin, user, invoice } as const
}

// GET → marcas con las que está compartida (activas y revocadas, para trazabilidad)
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await load(params)
  if ('response' in ctx) return ctx.response
  const { data, error } = await ctx.admin
    .from('invoice_shares')
    .select('id, brand_id, status, granted_by, granted_at, revoked_by, revoked_at')
    .eq('invoice_id', ctx.invoice.id)
    .order('granted_at', { ascending: false })
  if (error) {
    console.error('[GET /api/invoices/[id]/shares]', error)
    return NextResponse.json({ error: 'No se pudo leer el acceso compartido' }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? [] })
}

// POST { brand_id } → concede lectura a esa marca (idempotente; reactiva una revocada)
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await load(params)
  if ('response' in ctx) return ctx.response
  const body = await request.json().catch(() => null) as { brand_id?: unknown } | null
  if (!body || !isUuid(body.brand_id)) {
    return NextResponse.json({ error: 'brand_id debe ser un UUID válido' }, { status: 422 })
  }
  const targetBrandId = body.brand_id
  if (ctx.invoice.owner_brand_id && targetBrandId === ctx.invoice.owner_brand_id) {
    return NextResponse.json({ error: 'La marca propietaria ya tiene acceso a su factura' }, { status: 422 })
  }

  const { data: brand } = await ctx.admin.from('brands').select('id').eq('id', targetBrandId).maybeSingle()
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await ctx.admin
    .from('invoice_shares').select('id, status')
    .eq('invoice_id', ctx.invoice.id).eq('brand_id', targetBrandId).maybeSingle()
  if (existingError) {
    console.error('[POST /api/invoices/[id]/shares] lookup', existingError)
    return NextResponse.json({ error: 'No se pudo compartir la factura' }, { status: 500 })
  }
  if (existing?.status === 'active') return NextResponse.json({ data: existing })

  const write = existing
    ? ctx.admin.from('invoice_shares')
        .update({ status: 'active', granted_by: ctx.user.id, granted_at: now, revoked_by: null, revoked_at: null })
        .eq('id', existing.id).select('id, brand_id, status, granted_at')
    : ctx.admin.from('invoice_shares')
        .insert({ invoice_id: ctx.invoice.id, brand_id: targetBrandId, status: 'active', granted_by: ctx.user.id, granted_at: now })
        .select('id, brand_id, status, granted_at')
  const { data, error } = await write
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    console.error('[POST /api/invoices/[id]/shares] write', error)
    return NextResponse.json({ error: 'No se pudo compartir la factura' }, { status: 500 })
  }
  return NextResponse.json({ data: row }, { status: 201 })
}

// DELETE ?brand_id=… → revoca; esa marca deja de poder consultar la factura de inmediato
export async function DELETE(request: NextRequest, { params }: Params) {
  const ctx = await load(params)
  if ('response' in ctx) return ctx.response
  const targetBrandId = new URL(request.url).searchParams.get('brand_id')
  if (!isUuid(targetBrandId)) {
    return NextResponse.json({ error: 'brand_id debe ser un UUID válido' }, { status: 422 })
  }
  const now = new Date().toISOString()
  const { data, error } = await ctx.admin
    .from('invoice_shares')
    .update({ status: 'revoked', revoked_by: ctx.user.id, revoked_at: now })
    .eq('invoice_id', ctx.invoice.id).eq('brand_id', targetBrandId).eq('status', 'active')
    .select('id')
  if (error) {
    console.error('[DELETE /api/invoices/[id]/shares]', error)
    return NextResponse.json({ error: 'No se pudo revocar el acceso' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No hay acceso compartido activo con esa marca' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
