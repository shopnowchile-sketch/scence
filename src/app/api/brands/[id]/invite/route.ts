import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function brandInviteEmail({ name, actionLink, isResend }: { name: string; actionLink: string; isResend: boolean }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Acceso a tu portal Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">
        ${isResend ? 'Tu link de acceso' : `Hola ${name} 👋`}
      </h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        ${isResend
          ? 'Aquí tienes un nuevo link para ingresar a tu portal de marca en Scence.'
          : `Te invitamos a acceder al portal de marcas de <strong style="color:#111827">Scence</strong>. Podrás ver tus campañas, influencers asignados y aprobar contenido.`
        }
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        ${isResend ? 'Ingresar al portal →' : 'Acceder al portal →'}
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Este link expira en 24 horas.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Portal de Marcas</p>
    </div>
  </div>
</body>
</html>`
}

// ── POST /api/brands/[id]/invite ──────────────────────────────────────────────
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: brand, error: brandErr } = await admin
    .from('brands')
    .select('id, name, contact_email, contact_name, user_id, organization_id')
    .eq('id', params.id)
    .single()

  if (brandErr || !brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  if (!brand.contact_email) {
    return NextResponse.json(
      { error: 'La marca no tiene email de contacto. Agrégalo antes de invitar.' },
      { status: 422 }
    )
  }

  // ── Ya tiene cuenta → reenviar magic link ────────────────────────────────────
  if (brand.user_id) {
    await admin.auth.admin.updateUserById(brand.user_id, {
      user_metadata: { is_brand: true, brand_id: params.id },
    })

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: brand.contact_email,
      options: {
        redirectTo: `${APP_URL}/brand-dash`,
        data: { is_brand: true, brand_id: params.id },
      },
    })

    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })

    const actionLink = linkData?.properties?.action_link ?? null
    let emailSent = false
    if (actionLink) {
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: brand.contact_email,
        subject: 'Tu link de acceso a Scence',
        html: brandInviteEmail({ name: brand.contact_name ?? brand.name, actionLink, isResend: true }),
      })
      emailSent = !emailErr
    }

    return NextResponse.json({
      message: emailSent
        ? `Email reenviado a ${brand.contact_email}`
        : `Link generado (email falló — usa el link directo)`,
      already_linked: true,
      email_sent: emailSent,
      action_link: actionLink,
    })
  }

  // ── Crear o vincular auth user ────────────────────────────────────────────────
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find(u => u.email === brand.contact_email)

  let authUserId: string

  if (existingUser) {
    await admin.auth.admin.updateUserById(existingUser.id, {
      user_metadata: {
        ...existingUser.user_metadata,
        is_brand: true,
        brand_id: params.id,
        full_name: brand.contact_name ?? brand.name,
      },
    })
    authUserId = existingUser.id
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: brand.contact_email,
      email_confirm: true,
      user_metadata: {
        is_brand: true,
        brand_id: params.id,
        full_name: brand.contact_name ?? brand.name,
      },
    })
    if (createErr || !newUser?.user) {
      return NextResponse.json({ error: createErr?.message ?? 'Error creando usuario' }, { status: 500 })
    }
    authUserId = newUser.user.id
  }

  // Vincular user_id en la fila de brands
  await admin.from('brands').update({ user_id: authUserId }).eq('id', params.id)

  // Generar magic link
  const { data: linkData, error: inviteErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: brand.contact_email,
    options: {
      redirectTo: `${APP_URL}/brand-dash`,
      data: { is_brand: true, brand_id: params.id },
    },
  })

  if (inviteErr || !linkData?.properties?.action_link) {
    return NextResponse.json({
      message: `Usuario creado. Email falló — usa "Olvidé mi contraseña" con ${brand.contact_email}.`,
      user_id: authUserId,
      email_sent: false,
    })
  }

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: brand.contact_email,
    subject: `Bienvenido al portal de marcas — ${brand.name}`,
    html: brandInviteEmail({
      name: brand.contact_name ?? brand.name,
      actionLink: linkData.properties.action_link,
      isResend: false,
    }),
  })

  return NextResponse.json({
    message: !emailErr
      ? `Invitación enviada a ${brand.contact_email}`
      : `Usuario creado. Email falló — comparte el link manualmente.`,
    user_id: authUserId,
    email_sent: !emailErr,
    action_link: linkData.properties.action_link,
  })
}
