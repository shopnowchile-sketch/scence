/**
 * POST /api/settings/team/invite
 * Admin invita a un nuevo miembro del equipo por email + rol.
 * Crea (o actualiza) un auth user, lo vincula a la org y le envía magic link.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'
import { getResend, FROM_EMAIL } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

const VALID_ROLES = ['super_admin', 'agency_manager', 'brand_manager', 'finance', 'influencer']

function inviteEmail({ name, role, actionLink }: { name: string; role: string; actionLink: string }) {
  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin', agency_manager: 'Agency Manager',
    brand_manager: 'Brand Manager', finance: 'Finanzas', influencer: 'Influencer',
  }
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invitación a Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">
        Hola ${name} 👋
      </h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 8px">
        Te han invitado a unirte a <strong style="color:#111827">Scence</strong> como
        <strong style="color:#7c3aed">${roleLabel[role] ?? role}</strong>.
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Haz clic abajo para acceder al dashboard.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Acceder al dashboard →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Este link expira en 24 horas.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden invitar miembros' }, { status: 403 })
  }

  const body = await req.json()
  const { email, role, display_name } = body as { email?: string; role?: string; display_name?: string }

  if (!email || !role) return NextResponse.json({ error: 'email y role son requeridos' }, { status: 422 })
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Rol inválido' }, { status: 422 })

  const name = display_name?.trim() || email.split('@')[0]

  // Find or create auth user
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existing = existingUsers?.users?.find(u => u.email === email)

  let authUserId: string

  if (existing) {
    authUserId = existing.id
    // Update metadata to keep org context
    await admin.auth.admin.updateUserById(authUserId, {
      user_metadata: { ...existing.user_metadata, full_name: name },
    })
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    })
    if (createErr || !newUser?.user) {
      return NextResponse.json({ error: createErr?.message ?? 'Error creando usuario' }, { status: 500 })
    }
    authUserId = newUser.user.id
  }

  // Ensure profile exists
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', authUserId)
    .single()

  if (!existingProfile) {
    await admin.from('profiles').insert({
      id: authUserId,
      display_name: name,
      email,
      organization_id: orgId,
    })
  }

  // Upsert organization_members
  const { error: memberErr } = await admin
    .from('organization_members')
    .upsert(
      { organization_id: orgId, user_id: authUserId, role, is_owner: false },
      { onConflict: 'organization_id,user_id', ignoreDuplicates: false }
    )

  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }

  // Generate magic link
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${APP_URL}/admin-dash` },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json({
      message: `Miembro agregado. El email falló — usa "Olvidé mi contraseña" con ${email}.`,
      user_id: authUserId,
      email_sent: false,
    })
  }

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Invitación a Scence',
    html: inviteEmail({ name, role, actionLink: linkData.properties.action_link }),
  })

  return NextResponse.json({
    message: !emailErr
      ? `Invitación enviada a ${email}`
      : `Miembro agregado. Email falló — comparte el link manualmente.`,
    user_id: authUserId,
    email_sent: !emailErr,
    action_link: linkData.properties.action_link,
  })
}
