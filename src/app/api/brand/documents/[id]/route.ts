import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'

type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.user_metadata?.is_brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || (!access.isOwner && access.role !== 'brand_manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null) as { signer_name?: string; signer_rut?: string; signer_role?: string; accepted?: boolean } | null
  if (!body?.accepted || !body.signer_name?.trim() || !body.signer_rut?.trim() || !body.signer_role?.trim()) {
    return NextResponse.json({ error: 'Completa nombre, RUT, cargo y aceptación' }, { status: 422 })
  }
  const admin = createAdminClient()
  const [{ data: brand }, { data: document, error: documentError }, { data: signer }] = await Promise.all([
    admin.from('brands').select('name, rut, address_street, address_number, address_city, address_region, address_country').eq('id', access.brandId).single(),
    admin.from('brand_documents').select('id, template_id').eq('id', params.id).eq('brand_id', access.brandId).eq('status', 'pending').single(),
    admin.from('profiles').select('full_name, display_name, signer_rut, signer_role').eq('id', user.id).maybeSingle(),
  ])
  if (documentError || !document) return NextResponse.json({ error: 'Documento pendiente no encontrado' }, { status: 404 })
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const missing = [brand?.rut, brand?.address_street, brand?.address_city, brand?.address_region, brand?.address_country].some(value => !String(value ?? '').trim())
  if (missing) return NextResponse.json({ error: 'Completa los datos legales de la empresa en Mi perfil → Organización antes de firmar.' }, { status: 422 })
  if (!signer?.signer_rut || !signer?.signer_role) return NextResponse.json({ error: 'Completa tu RUT y cargo en Mi perfil antes de firmar.' }, { status: 422 })
  const { data: template } = document.template_id ? await admin.from('contract_templates').select('content').eq('id', document.template_id).single() : { data: null }
  const address = [brand.address_street, brand.address_number, brand.address_city, brand.address_region, brand.address_country].filter(Boolean).join(', ')
  const contentSnapshot = template?.content ? renderDocument(template.content, {
    brand_name: brand.name, brand_rut: brand.rut, brand_address: address,
    signer_name: body.signer_name.trim(), signer_rut: body.signer_rut.trim(), signer_role: body.signer_role.trim(),
  }) : undefined
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const { data, error } = await admin.from('brand_documents').update({
    status: 'signed', signer_name: body.signer_name.trim(), signer_rut: body.signer_rut.trim(), signer_email: user.email ?? null,
    signer_role: body.signer_role.trim(), accepted_at: new Date().toISOString(), signed_at: new Date().toISOString(),
    signed_by: user.id, acceptance_ip: ip,
    ...(contentSnapshot ? { content_snapshot: contentSnapshot } : {}),
  }).eq('id', params.id).eq('brand_id', access.brandId).eq('status', 'pending')
    .select('id, status, signed_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
