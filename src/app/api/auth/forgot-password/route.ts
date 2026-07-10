import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, passwordResetEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Genera un link de recuperación basado en token_hash (no PKCE) y lo envía
// vía Resend — mismo patrón que /api/influencers/[id]/invite. Reemplaza el
// supabase.auth.resetPasswordForEmail() del cliente, que dependía del email
// template de Supabase y del flujo PKCE (rompía si el link se abría en otro
// navegador/app).
//
// Responde siempre { ok: true } exista o no la cuenta — no enumeration.
export async function POST(req: NextRequest) {
  let email: string | null = null
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  } catch {
    // no-op — email queda null
  }

  if (!email) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  })

  if (error || !data?.properties?.hashed_token) {
    // No revelamos si el email existe — solo logueamos server-side para debug.
    console.error('[forgot-password] generateLink error:', error?.message ?? 'sin hashed_token')
    return NextResponse.json({ ok: true })
  }

  const actionLink = `${APP_URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Restablece tu contraseña — Scence',
    html: passwordResetEmail({ actionLink }),
  })

  if (emailErr) console.error('[forgot-password] Resend error:', emailErr)

  return NextResponse.json({ ok: true })
}
