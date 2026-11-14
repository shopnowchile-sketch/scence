import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'
import { BRAND_LEGAL_FIX_URL, BRAND_LEGAL_SELECT, PROFILE_LEGAL_SELECT, buildBrandLegalProfile, legalDocumentContext } from '@/lib/brand-legal-profile'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'legal_document.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const [{ data, error }, { data: brand }, { data: representative }] = await Promise.all([
    admin.from('brand_documents')
    .select('id, template_id, title, document_type, language, status, content_snapshot, signer_name, signer_rut, signer_role, signer_email, signed_at, due_at, created_at')
    .eq('brand_id', access.brandId).order('created_at', { ascending: false })
    ,
    admin.from('brands').select(BRAND_LEGAL_SELECT).eq('id', access.brandId).single(),
    admin.from('profiles').select(PROFILE_LEGAL_SELECT).eq('id', user.id).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Fuente única de datos legales (lib/brand-legal-profile.ts): el NDA los muestra, nunca los pide.
  const legal = buildBrandLegalProfile(brand, representative)
  const templateIds = (data ?? []).map(d => d.template_id).filter(Boolean) as string[]
  const { data: templates } = templateIds.length ? await admin.from('contract_templates').select('id, content').in('id', templateIds) : { data: [] }
  const byTemplate = new Map((templates ?? []).map(template => [template.id, template.content]))
  const hydrated = (data ?? []).map(document => document.status === 'pending' && document.template_id && byTemplate.has(document.template_id)
    ? { ...document, signer_name: legal.representative.name, signer_rut: legal.representative.rut, signer_role: legal.representative.role, signer_email: user.email ?? null, content_snapshot: renderDocument(byTemplate.get(document.template_id)!, legalDocumentContext(legal)) }
    : document)
  return NextResponse.json({
    data: hydrated,
    can_sign: hasBrandPermission(access, 'legal_document.manage'),
    legal_profile_complete: legal.complete,
    missing_legal_fields: legal.missing.map(field => field.label),
    missing: legal.missing,
    fix_url: BRAND_LEGAL_FIX_URL,
    legal_data: { company: legal.company, representative: legal.representative },
  })
}
