import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.user_metadata?.is_brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const [{ data, error }, { data: brand }, { data: signer }] = await Promise.all([
    admin.from('brand_documents')
    .select('id, template_id, title, document_type, language, status, content_snapshot, signer_name, signer_rut, signer_role, signer_email, signed_at, due_at, created_at')
    .eq('brand_id', access.brandId).order('created_at', { ascending: false })
    ,
    admin.from('brands').select('name, rut, address_street, address_number, address_city, address_region, address_country').eq('id', access.brandId).single(),
    admin.from('profiles').select('full_name, display_name, signer_rut, signer_role').eq('id', user.id).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const missing = [
    ['RUT', brand?.rut], ['calle', brand?.address_street], ['comuna o ciudad', brand?.address_city], ['región o estado', brand?.address_region], ['país', brand?.address_country],
  ].filter(([, value]) => !String(value ?? '').trim()).map(([label]) => label)
  const templateIds = (data ?? []).map(d => d.template_id).filter(Boolean) as string[]
  const { data: templates } = templateIds.length ? await admin.from('contract_templates').select('id, content').in('id', templateIds) : { data: [] }
  const byTemplate = new Map((templates ?? []).map(template => [template.id, template.content]))
  const address = [brand?.address_street, brand?.address_number, brand?.address_city, brand?.address_region, brand?.address_country].filter(Boolean).join(', ')
  const hydrated = (data ?? []).map(document => document.status === 'pending' && document.template_id && byTemplate.has(document.template_id)
    ? { ...document, signer_name: signer?.full_name || signer?.display_name || '', signer_rut: signer?.signer_rut || '', signer_role: signer?.signer_role || '', signer_email: user.email ?? null, content_snapshot: renderDocument(byTemplate.get(document.template_id)!, { brand_name: brand?.name, brand_rut: brand?.rut, brand_address: address, signer_name: signer?.full_name || signer?.display_name || '', signer_rut: signer?.signer_rut || '', signer_role: signer?.signer_role || '' }) }
    : document)
  return NextResponse.json({ data: hydrated, can_sign: access.isOwner || access.role === 'brand_manager', legal_profile_complete: missing.length === 0, missing_legal_fields: missing })
}
