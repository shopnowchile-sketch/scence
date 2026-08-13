import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess, type BrandAccess } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

const MEMBER_ROLES = ['brand_manager', 'finance', 'member'] as const

function brandMemberInviteEmail({ brandName, actionLink }: { brandName: string; actionLink: string }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invitación a Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Te invitaron a un equipo 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Te invitaron a acceder al portal de marca de <strong style="color:#111827">${brandName}</strong> en Scence.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Acceder al portal →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">Este link expira en 24 horas.</p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Portal de Marcas</p>
    </div>
  </div>
</body>
</html>`
}

// Gestionar el equipo (invitar/desactivar) queda reservado al owner de la
// marca — spec Pri no extiende esto a brand_manager en esta ronda.
async function getOwnerBrand() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { user: null, brand: null }

  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'team.manage')) return { user: null, brand: null }

  const admin = createAdminClient()
  const { data: brand } = await admin
    .from('brands')
    .select('id, organization_id, name')
    .eq('id', access.brandId)
    .single()

  return { user, brand: brand ?? null }
}

// Ver el equipo sí está disponible para owner o cualquier miembro activo
// (brand_manager/finance/member) — solo lectura.
async function getViewerAccess(): Promise<{ userId: string; access: BrandAccess } | null> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'team.read')) return null

  return { userId: user.id, access }
}

// GET /api/brand/members — lista de usuarios con acceso a la marca
export async function GET() {
  const viewer = await getViewerAccess()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const [
    { data: members, error: membersError },
    { data: brand, error: brandError },
  ] = await Promise.all([
    admin
      .from('brand_members')
      .select('id, email, role, invited_at, joined_at, is_active')
      .eq('brand_id', viewer.access.brandId)
      .order('invited_at', { ascending: false }),
    admin
      .from('brands')
      .select('user_id, contact_email, created_at')
      .eq('id', viewer.access.brandId)
      .maybeSingle(),
  ])

  const queryError = membersError ?? brandError
  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  const rows = [...(members ?? [])]

  if (brand?.user_id) {
    const { data: ownerAuth } = await admin.auth.admin.getUserById(brand.user_id)
    const ownerEmail = ownerAuth?.user?.email ?? brand.contact_email

    const alreadyIncluded = rows.some(member =>
      member.role === 'owner' ||
      (!!ownerEmail && member.email.toLowerCase() === ownerEmail.toLowerCase())
    )

    if (ownerEmail && !alreadyIncluded) {
      rows.unshift({
        id: `owner-${brand.user_id}`,
        email: ownerEmail,
        role: 'owner',
        invited_at: brand.created_at ?? new Date().toISOString(),
        joined_at: brand.created_at ?? new Date().toISOString(),
        is_active: true,
      })
    }
  }

  const sorted = rows.slice().sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1
    if (a.role !== 'owner' && b.role === 'owner') return 1
    return 0
  })

  return NextResponse.json({ data: sorted })
}

// POST /api/brand/members — invitar nuevo usuario (solo owner)
// Roles mínimos: brand_manager, finance, member (spec Pri 2026-07-10). Crea
// la fila de invitación en brand_members y, a diferencia de la versión
// anterior, envía el email de invitación y crea/reutiliza el usuario de
// Auth — mismo patrón token_hash ya validado en /api/brands/[id]/invite.
export async function POST(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { email?: string; role?: string; member_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const email = (body.email ?? '').trim().toLowerCase()
  const role = body.role ?? 'member'
  const resendMemberId = body.member_id
  if (resendMemberId) {
    const admin = createAdminClient()
    const { data: member, error: memberError } = await admin.from('brand_members').select('id, email, user_id, role, is_active').eq('id', resendMemberId).eq('brand_id', brand.id).maybeSingle()
    if (memberError || !member) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    if (!member.is_active) return NextResponse.json({ error: 'Este usuario está desactivado' }, { status: 422 })
    let actionLink: string | null = null
    let emailSent = false
    try {
      const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      let memberUser = existingUsers?.users.find(existing => existing.email?.toLowerCase() === member.email.toLowerCase()) ?? null
      if (!memberUser) {
        const { data: created } = await admin.auth.admin.createUser({ email: member.email, email_confirm: true, user_metadata: { is_brand: true, full_name: member.email.split('@')[0] } })
        memberUser = created.user
      }
      if (!memberUser) throw new Error('No se pudo resolver el usuario invitado')
      const orgRole = member.role === 'finance' ? 'finance' : member.role === 'member' ? 'member' : 'brand_manager'
      const { error: officialError } = await admin.from('organization_members').upsert({
        organization_id: brand.organization_id,
        brand_id: brand.id,
        user_id: memberUser.id,
        role: orgRole,
        is_owner: false,
        is_active: true,
        joined_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,user_id' })
      if (officialError) throw officialError
      await admin.from('brand_members').update({ user_id: memberUser.id, joined_at: new Date().toISOString() }).eq('id', member.id)
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: member.email, options: { redirectTo: `${APP_URL}/brand-dash` } })
      if (linkError || !linkData?.properties?.hashed_token) throw linkError ?? new Error('No se pudo generar el link')
      actionLink = `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`
      const { error: emailError } = await getResend().emails.send({ from: FROM_EMAIL, to: member.email, subject: `Tu acceso al portal de ${brand.name} — Scence`, html: brandMemberInviteEmail({ brandName: brand.name, actionLink }) })
      emailSent = !emailError
    } catch (error) { console.error('[POST /api/brand/members] resend failed:', error) }
    return NextResponse.json({ message: emailSent ? `Acceso enviado a ${member.email}` : 'Link generado; el email no pudo enviarse', email_sent: emailSent, action_link: actionLink })
  }
  if (!email) return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Insertar en brand_members (invitación pendiente)
  const { data, error } = await admin
    .from('brand_members')
    .insert({
      brand_id:   brand.id,
      email,
      role,
      invited_by: user.id,
    })
    .select('id, email, role, invited_at, joined_at, is_active')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Este email ya fue invitado' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enviar invitación por email. No bloqueante: si falla, la fila de
  // invitación ya quedó creada — el owner puede reintentar reenviando (borra
  // y vuelve a invitar) o el admin puede resolverlo a mano.
  let emailSent = false
  let officialMembershipReady = false
  try {
    const { data: existingUsers } = await admin.auth.admin.listUsers()
    let existingUser = existingUsers?.users?.find(u => u.email === email) ?? null

    if (!existingUser) {
      const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { is_brand: true, full_name: email.split('@')[0] },
      })
      if (createUserError) throw createUserError
      existingUser = createdUser.user
    }

    if (!existingUser) throw new Error('No se pudo resolver el usuario invitado')
    const orgRole = role === 'finance' ? 'finance' : role === 'member' ? 'member' : 'brand_manager'
    const { error: officialError } = await admin.from('organization_members').upsert({
      organization_id: brand.organization_id,
      brand_id: brand.id,
      user_id: existingUser.id,
      role: orgRole,
      is_owner: false,
      is_active: true,
      joined_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,user_id' })
    if (officialError) throw officialError
    await admin.from('brand_members').update({ user_id: existingUser.id, joined_at: new Date().toISOString() }).eq('id', data.id)
    officialMembershipReady = true

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${APP_URL}/brand-dash` },
    })

    if (!linkErr && linkData?.properties?.hashed_token) {
      const actionLink = `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `Invitación al portal de ${brand.name} — Scence`,
        html: brandMemberInviteEmail({ brandName: brand.name, actionLink }),
      })
      emailSent = !emailErr
    }
  } catch (e) {
    console.error('[POST /api/brand/members] invite email error:', e)
  }

  if (!officialMembershipReady) {
    return NextResponse.json({ error: 'No se pudo crear la membresía oficial del usuario' }, { status: 500 })
  }

  return NextResponse.json({ data: { ...data, email_sent: emailSent } }, { status: 201 })
}

// DELETE /api/brand/members?id=... — desactivar miembro (solo owner)
export async function DELETE(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberId = request.nextUrl.searchParams.get('id')
  if (!memberId) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('brand_members')
    .select('user_id')
    .eq('id', memberId)
    .eq('brand_id', brand.id)
    .maybeSingle()
  const { error } = await admin
    .from('brand_members')
    .update({ is_active: false })
    .eq('id', memberId)
    .eq('brand_id', brand.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (member?.user_id) {
    const { error: officialError } = await admin
      .from('organization_members')
      .update({ is_active: false })
      .eq('organization_id', brand.organization_id)
      .eq('user_id', member.user_id)
    if (officialError) return NextResponse.json({ error: officialError.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
