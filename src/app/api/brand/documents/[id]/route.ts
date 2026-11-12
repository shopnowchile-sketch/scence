import { getUserEmails } from '@/lib/user-email'
import { brandHasCurrentSubscription, AGENCY_SUBSCRIPTION_REQUIRED } from '@/lib/agency-brands'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { renderDocument } from '@/lib/document-templates'
import { BRAND_LEGAL_SELECT, PROFILE_LEGAL_SELECT, buildBrandLegalProfile, legalDocumentContext, legalIncompleteBody, signedLegalData } from '@/lib/brand-legal-profile'
import { FROM_EMAIL, getResend } from '@/lib/resend'
import { escapeHtml } from '@/lib/utils'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'

type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'legal_document.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // El NDA NO pide datos: usa los registrados en Organización (perfil legal). El cuerpo solo trae la aceptación;
  // cualquier signer_* que llegue se ignora a propósito (fuente única: lib/brand-legal-profile.ts).
  const body = await request.json().catch(() => null) as { accepted?: boolean } | null
  if (body?.accepted !== true) return NextResponse.json({ error: 'Debes aceptar el documento para firmarlo' }, { status: 422 })
  const admin = createAdminClient()
  const [{ data: brand }, { data: document, error: documentError }, { data: representative }] = await Promise.all([
    admin.from('brands').select(BRAND_LEGAL_SELECT).eq('id', access.brandId).single(),
    admin.from('brand_documents').select('id, template_id, title, document_type, metadata').eq('id', params.id).eq('brand_id', access.brandId).eq('status', 'pending').single(),
    admin.from('profiles').select(PROFILE_LEGAL_SELECT).eq('user_id', user.id).maybeSingle(),
  ])
  if (documentError || !document) return NextResponse.json({ error: 'Documento pendiente no encontrado' }, { status: 404 })
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (document.document_type === 'nda' && access.status === 'pending_approval'
    && !(await brandHasCurrentSubscription(admin, access.brandId))) {
    return NextResponse.json({
      error: 'Completa el pago desde tu borrador de campaña antes de firmar el NDA.',
      code: AGENCY_SUBSCRIPTION_REQUIRED,
    }, { status: 402 })
  }
  const legal = buildBrandLegalProfile(brand, representative)
  if (!legal.complete) return NextResponse.json(legalIncompleteBody(legal.missing), { status: 422 })
  const { data: template } = document.template_id ? await admin.from('contract_templates').select('content').eq('id', document.template_id).single() : { data: null }
  const contentSnapshot = template?.content ? renderDocument(template.content, legalDocumentContext(legal)) : undefined
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const signedTimestamp = new Date().toISOString()
  const { data, error } = await admin.from('brand_documents').update({
    status: 'signed', signer_name: legal.representative.name, signer_rut: legal.representative.rut, signer_email: user.email ?? null,
    signer_role: legal.representative.role, accepted_at: signedTimestamp, signed_at: signedTimestamp,
    signed_by: user.id, acceptance_ip: ip,
    ...(contentSnapshot ? { content_snapshot: contentSnapshot } : {}),
    // Copia histórica de empresa y representante al momento de firmar (no cambia aunque luego se edite el perfil).
    metadata: { ...((document.metadata as Record<string, unknown> | null) ?? {}), signed_legal_data: signedLegalData(legal, user.id) },
  }).eq('id', params.id).eq('brand_id', access.brandId).eq('status', 'pending')
    .select('id, status, signed_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aviso al owner y super_admins: registro in-app y email. Ningún fallo de
  // notificación puede impedir que la firma ya registrada sea válida.
  try {
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, role, is_owner')
      .eq('organization_id', brand.organization_id)
    const admins = (members ?? []).filter(member => member.is_owner || member.role === 'super_admin')
    const title = document.document_type === 'nda' ? `NDA firmado por ${brand.name}` : `Documento firmado por ${brand.name}`
    const signedAt = data.signed_at ? new Date(data.signed_at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : 'recién'
    const bodyText = `${legal.representative.name} (${legal.representative.role}) firmó ${document.title} el ${signedAt}.`

    if (admins.length > 0) {
      await admin.from('notifications').insert(admins.map(member => ({
        recipient_id: member.user_id, type: 'contract', title, body: bodyText,
        action_url: `/admin-brands/${brand.id}?tab=documents`, entity_type: 'brand_document', entity_id: document.id,
        sent_via: ['in_app'],
      })))
    }

    const adminEmails = await getUserEmails(admin, admins.map(member => member.user_id as string))
    const memberEmails = admins.map(member => adminEmails[member.user_id as string] ?? null)
      .filter((email): email is string => Boolean(email))
    const fallbackEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'hola.scence@gmail.com'
    const recipients = Array.from(new Set([...memberEmails, fallbackEmail.trim().toLowerCase()].filter(Boolean)))
    if (recipients.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
      const { error: emailError } = await getResend().emails.send({
        from: FROM_EMAIL, to: recipients, tags: [emailAudience('brand')], subject: `[SCENCE] ${title}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto"><div style="background:#7c3aed;color:#fff;padding:24px;font-size:21px;font-weight:800">SCENCE</div><div style="padding:28px"><h1 style="font-size:22px;color:#111827;margin:0 0 14px">${escapeHtml(title)}</h1><p style="color:#4b5563;line-height:1.6">${escapeHtml(bodyText)}</p><a href="${appUrl}/admin-brands/${brand.id}?tab=documents" style="display:block;margin-top:24px;background:#7c3aed;color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:700">Ver NDA firmado →</a></div></div>`,
      })
      if (emailError) console.error('[brand document signed] admin email failed:', emailError.message)
    }
  } catch (notificationError) {
    console.error('[brand document signed] admin notification failed:', notificationError)
  }
  return NextResponse.json({ data })
}
