import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { findAuthUserByEmail } from '@/lib/supabase/findAuthUser'
import { getResend, FROM_EMAIL, influencerSignupConfirmEmail, brandSignupConfirmEmail } from '@/lib/resend'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { rateLimit, clientIp } from '@/lib/simple-rate-limit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// Reenvía el enlace de confirmación a una cuenta creada y aún sin confirmar.
// Pública (se llama desde el login, sin sesión). La respuesta es siempre la misma
// exista o no la cuenta, para no revelar qué correos están registrados. Solo
// opera sobre usuarios existentes sin confirmar: nunca crea cuentas.
export async function POST(req: NextRequest) {
  if (!rateLimit(`resend-confirmation:ip:${clientIp(req.headers)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }, { status: 429 })
  }
  const body = await req.json().catch(() => null) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 422 })
  if (!rateLimit(`resend-confirmation:email:${email}`, 3, 60 * 60_000)) {
    return NextResponse.json({ ok: true })
  }

  try {
    const admin = createAdminClient()
    const user = await findAuthUserByEmail(admin, email)
    if (!user || user.email_confirmed_at) return NextResponse.json({ ok: true })

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const isInfluencer = meta.is_influencer === true
    const name = String(meta.display_name ?? meta.full_name ?? 'Hola')
    // generateLink sobre un usuario ya existente: no crea cuentas nuevas.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[resend-confirmation] generateLink error:', linkError?.message)
      return NextResponse.json({ ok: true })
    }
    const next = isInfluencer ? '/' : '/brand-dash'
    const actionLink = `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`
    const { error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      tags: [emailAudience('account')],
      subject: 'Confirma tu cuenta — SCENCE',
      html: isInfluencer
        ? influencerSignupConfirmEmail({ displayName: name, actionLink })
        : brandSignupConfirmEmail({ contactName: name, actionLink }),
    })
    if (emailError) console.error('[resend-confirmation] Resend error:', JSON.stringify(emailError))
  } catch (error) {
    console.error('[resend-confirmation] error:', error instanceof Error ? error.message : error)
  }
  return NextResponse.json({ ok: true })
}
