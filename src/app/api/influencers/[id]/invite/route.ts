import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function portalInviteEmail({
  name,
  actionLink,
  isResend,
}: {
  name: string
  actionLink: string
  isResend: boolean
}): string {
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
          ? 'Aquí tienes un nuevo link para ingresar a tu portal de influencer.'
          : `Te invitamos a unirte al portal de influencers de <strong style="color:#111827">Scence</strong>. Haz clic abajo para crear tu contraseña y acceder.`
        }
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        ${isResend ? 'Ingresar al portal →' : 'Crear contraseña y entrar →'}
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Este link expira en 24 horas. Si no esperabas este correo puedes ignorarlo.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Portal de Influencers</p>
    </div>
  </div>
</body>
</html>`
}

async function sendInviteEmail(email: string, name: string, actionLink: string, isResend: boolean) {
  const resend = getResend()
  return resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: isResend ? 'Tu link de acceso a Scence' : 'Bienvenido a Scence — Crea tu contraseña',
    html: portalInviteEmail({ name, actionLink, isResend }),
  })
}

// ── POST /api/influencers/[id]/invite ─────────────────────────────────────────
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: influencer, error: infErr } = await admin
    .from('influencers')
    .select('id, display_name, email, user_id')
    .eq('id', params.id)
    .single()

  if (infErr || !influencer) {
    return NextResponse.json({ error: 'Influencer no encontrado' }, { status: 404 })
  }

  if (!influencer.email) {
    return NextResponse.json(
      { error: 'El influencer no tiene email. Agrega un email antes de invitar.' },
      { status: 422 }
    )
  }

  // ── Already linked → resend magic link via Resend ───────────────────────────
  if (influencer.user_id) {
    await admin.auth.admin.updateUserById(influencer.user_id, {
      user_metadata: { is_influencer: true },
    })

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: influencer.email,
      options: {
        redirectTo: `${APP_URL}/inf-dash`,
        data: { is_influencer: true },
      },
    })

    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }

    const actionLink = linkData?.properties?.action_link ?? null
    let emailSent = false
    if (actionLink) {
      const { error: emailErr } = await sendInviteEmail(influencer.email, influencer.display_name, actionLink, true)
      emailSent = !emailErr
      if (emailErr) console.error('[invite resend] email error:', emailErr)
    }

    return NextResponse.json({
      message: emailSent
        ? `Email reenviado a ${influencer.email}`
        : `Link generado (email falló — usa el link de acceso directo)`,
      already_linked: true,
      email_sent: emailSent,
      action_link: actionLink,  // siempre retornar para copiar manualmente
    })
  }

  // ── Check / create auth user ─────────────────────────────────────────────────
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find(u => u.email === influencer.email)

  let authUserId: string

  if (existingUser) {
    await admin.auth.admin.updateUserById(existingUser.id, {
      user_metadata: {
        ...existingUser.user_metadata,
        is_influencer: true,
        influencer_id: params.id,
      },
    })
    authUserId = existingUser.id
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: influencer.email,
      email_confirm: true, // mark confirmed so they can use magic link directly
      user_metadata: {
        is_influencer: true,
        influencer_id: params.id,
        full_name: influencer.display_name,
      },
    })

    if (createErr || !newUser?.user) {
      return NextResponse.json({ error: createErr?.message ?? 'Error creando usuario' }, { status: 500 })
    }

    authUserId = newUser.user.id
  }

  // ── Link user_id on influencer row ───────────────────────────────────────────
  const { error: linkInfluencerErr } = await admin
    .from('influencers')
    .update({ user_id: authUserId })
    .eq('id', params.id)

  if (linkInfluencerErr) {
    return NextResponse.json({ error: linkInfluencerErr.message }, { status: 500 })
  }

  // ── Generate magic link and send via Resend ──────────────────────────────────
  const { data: linkData, error: inviteErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: influencer.email,
    options: {
      redirectTo: `${APP_URL}/inf-dash`,
      data: { is_influencer: true },
    },
  })

  if (inviteErr || !linkData?.properties?.action_link) {
    console.error('[invite] generateLink failed:', inviteErr?.message)
    return NextResponse.json({
      message: `Usuario creado pero no se pudo generar el link de acceso. El influencer puede usar "Olvidé mi contraseña" con ${influencer.email}.`,
      user_id: authUserId,
      email_sent: false,
    })
  }

  const { error: emailErr } = await sendInviteEmail(
    influencer.email,
    influencer.display_name,
    linkData.properties.action_link,
    false,
  )

  const emailSent = !emailErr
  if (emailErr) console.error('[invite] Resend failed:', emailErr)

  return NextResponse.json({
    message: emailSent
      ? `Invitación enviada a ${influencer.email}`
      : `Usuario creado. El email falló — comparte el link manualmente.`,
    user_id: authUserId,
    email_sent: emailSent,
    action_link: linkData.properties.action_link, // siempre retornar
  })
}
