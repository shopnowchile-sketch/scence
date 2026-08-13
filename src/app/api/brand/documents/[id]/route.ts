import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'
import { FROM_EMAIL, getResend } from '@/lib/resend'

type Params = { params: { id: string } }

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || (!access.isOwner && access.role !== 'brand_manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null) as { signer_name?: string; signer_rut?: string; signer_role?: string; accepted?: boolean } | null
  if (!body?.accepted || !body.signer_name?.trim() || !body.signer_rut?.trim() || !body.signer_role?.trim()) {
    return NextResponse.json({ error: 'Completa nombre, RUT, cargo y aceptación' }, { status: 422 })
  }
  const admin = createAdminClient()
  const [{ data: brand }, { data: document, error: documentError }, { data: signer }] = await Promise.all([
    admin.from('brands').select('id, organization_id, name, rut, address_street, address_number, address_city, address_region, address_country').eq('id', access.brandId).single(),
    admin.from('brand_documents').select('id, template_id, title, document_type').eq('id', params.id).eq('brand_id', access.brandId).eq('status', 'pending').single(),
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

  // Aviso al owner y super_admins: registro in-app y email. Ningún fallo de
  // notificación puede impedir que la firma ya registrada sea válida.
  try {
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, role, is_owner, profile:profiles(email)')
      .eq('organization_id', brand.organization_id)
    const admins = (members ?? []).filter(member => member.is_owner || member.role === 'super_admin')
    const title = document.document_type === 'nda' ? `NDA firmado por ${brand.name}` : `Documento firmado por ${brand.name}`
    const signedAt = data.signed_at ? new Date(data.signed_at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : 'recién'
    const bodyText = `${body.signer_name.trim()} (${body.signer_role.trim()}) firmó ${document.title} el ${signedAt}.`

    if (admins.length > 0) {
      await admin.from('notifications').insert(admins.map(member => ({
        recipient_id: member.user_id, type: 'contract', title, body: bodyText,
        action_url: `/admin-brands/${brand.id}?tab=documents`, entity_type: 'brand_document', entity_id: document.id,
        sent_via: ['in_app'],
      })))
    }

    const memberEmails = admins.map(member => {
      const profile = member.profile as unknown as { email?: string | null } | null
      return profile?.email?.trim().toLowerCase() ?? null
    }).filter((email): email is string => Boolean(email))
    const fallbackEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'hola.scence@gmail.com'
    const recipients = Array.from(new Set([...memberEmails, fallbackEmail.trim().toLowerCase()].filter(Boolean)))
    if (recipients.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
      const { error: emailError } = await getResend().emails.send({
        from: FROM_EMAIL, to: recipients, subject: `[SCENCE] ${title}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto"><div style="background:#7c3aed;color:#fff;padding:24px;font-size:21px;font-weight:800">SCENCE</div><div style="padding:28px"><h1 style="font-size:22px;color:#111827;margin:0 0 14px">${escapeHtml(title)}</h1><p style="color:#4b5563;line-height:1.6">${escapeHtml(bodyText)}</p><a href="${appUrl}/admin-brands/${brand.id}?tab=documents" style="display:block;margin-top:24px;background:#7c3aed;color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:700">Ver NDA firmado →</a></div></div>`,
      })
      if (emailError) console.error('[brand document signed] admin email failed:', emailError.message)
    }
  } catch (notificationError) {
    console.error('[brand document signed] admin notification failed:', notificationError)
  }
  return NextResponse.json({ data })
}
