import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'
import { FROM_EMAIL, getResend } from '@/lib/resend'

type Params = { params: { id: string } }

async function requireAdmin() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, admin: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  if (!role?.isAdmin) return { user: null, admin: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, admin, response: null }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { admin, response } = await requireAdmin()
  if (response || !admin) return response!
  const { data, error } = await admin.from('brand_documents')
    .select('id, title, document_type, language, status, template_version, content_snapshot, signer_name, signer_rut, signer_email, signer_role, signed_at, due_at, created_at')
    .eq('brand_id', params.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { user, admin, response } = await requireAdmin()
  if (response || !admin || !user) return response!
  const body = await request.json().catch(() => null) as { template_id?: string } | null
  if (!body?.template_id) return NextResponse.json({ error: 'template_id is required' }, { status: 422 })

  const [{ data: brand, error: brandError }, { data: template, error: templateError }] = await Promise.all([
    admin.from('brands').select('id, name, rut, address_street, address_number, address_city, address_region, address_country, contact_name, contact_email').eq('id', params.id).single(),
    admin.from('contract_templates').select('id, name, content, document_type, language, version').eq('id', body.template_id).single(),
  ])
  if (brandError || !brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
  if (templateError || !template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const address = [brand.address_street, brand.address_number, brand.address_city, brand.address_region, brand.address_country].filter(Boolean).join(', ')
  const content = renderDocument(template.content, {
    brand_name: brand.name, brand_rut: brand.rut, brand_address: address,
    signer_name: brand.contact_name, signer_rut: '', signer_role: '',
  })
  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const { data, error } = await admin.from('brand_documents').insert({
    brand_id: brand.id, template_id: template.id, document_type: template.document_type,
    language: template.language, title: template.name, template_version: template.version,
    content_snapshot: content, signer_email: brand.contact_email, due_at: dueAt.toISOString(), created_by: user.id,
  }).select('id, title, status, due_at, created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
  let emailSent = false
  if (brand.contact_email) {
    const deadline = dueAt.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    const { error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL, to: brand.contact_email,
      subject: `Acción requerida: firma tu NDA SCENCE antes del ${deadline}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><div style="background:#7c3aed;color:white;padding:24px;font-size:22px;font-weight:800">SCENCE</div><div style="padding:28px"><h1 style="font-size:22px;color:#111827">Tienes un documento pendiente de firma</h1><p style="color:#4b5563;line-height:1.6">Hola ${brand.contact_name ?? brand.name},</p><p style="color:#4b5563;line-height:1.6">Para resguardar la información y base de creadoras de SCENCE, <strong>${brand.name}</strong> debe firmar el <strong>${template.name}</strong>.</p><div style="background:#fff7ed;border-radius:10px;padding:16px;color:#9a3412"><strong>Plazo:</strong> tienes hasta el ${deadline} para completarlo.</div><a href="${appUrl}/brand-documents" style="display:block;margin-top:24px;background:#7c3aed;color:white;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:bold">Revisar y firmar documento →</a><p style="color:#9ca3af;font-size:12px;line-height:1.5">La firma se realiza en el portal de SCENCE por el representante autorizado de la Marca.</p></div></div>`,
    })
    emailSent = !emailError
    if (emailSent) await admin.from('brand_documents').update({ initial_email_sent_at: new Date().toISOString() }).eq('id', data.id)
  }
  return NextResponse.json({ data, email_sent: emailSent }, { status: 201 })
}
