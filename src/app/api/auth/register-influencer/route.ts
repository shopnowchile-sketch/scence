import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, influencerSignupConfirmEmail } from '@/lib/resend'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { rateLimit, clientIp } from '@/lib/simple-rate-limit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// Registro de creadores. Antes el formulario llamaba a supabase.auth.signUp()
// desde el navegador, lo que dependía del SMTP integrado de Supabase (lento y
// con tope de envíos por hora) y del flujo PKCE (el link falla si se abre en
// otro navegador/app). Ahora se crea el usuario server-side y el correo de
// confirmación sale de inmediato por Resend, igual que en /api/auth/register-brand.
// handle_new_user() sigue creando influencer + Instagram a partir de user_metadata.
export async function POST(req: NextRequest) {
  // Endpoint público: freno por IP (mejor esfuerzo, ver simple-rate-limit.ts).
  // 10 intentos/10 min cubre redes compartidas (universidades, eventos).
  if (!rateLimit(`register-influencer:ip:${clientIp(req.headers)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const displayName = str(body.display_name)
  const email = str(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const instagram = str(body.instagram_username)
  const locationId = str(body.location_id)
  const address = str(body.address)
  const birthDate = str(body.birth_date)

  if (displayName.length < 2) return NextResponse.json({ error: 'Nombre inválido' }, { status: 422 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 422 })
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json({ error: 'La contraseña no cumple los requisitos mínimos' }, { status: 422 })
  }
  if (!instagram || address.length < 5 || !birthDate) {
    return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 422 })
  }
  // handle_new_user() valida estos campos y, si fallan, Auth responde un error
  // genérico; se validan antes para devolver un mensaje útil.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)) {
    return NextResponse.json({ error: 'Selecciona tu ubicación' }, { status: 422 })
  }
  const birth = new Date(`${birthDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(birth.getTime()) || birth.getTime() >= Date.now()) {
    return NextResponse.json({ error: 'Fecha de nacimiento inválida' }, { status: 422 })
  }

  // Un mismo email no puede disparar más de 3 intentos/hora (evita usar el
  // endpoint para llenar de correos una casilla ajena).
  if (!rateLimit(`register-influencer:email:${email}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }, { status: 429 })
  }

  const admin = createAdminClient()

  // createUser falla si el email ya existe: no se puede pisar una cuenta ajena.
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      full_name: displayName,
      display_name: displayName,
      is_influencer: true,
      instagram_username: instagram,
      location_id: locationId,
      address,
      birth_date: birthDate,
    },
  })

  if (createError || !newUser?.user) {
    const msg = createError?.message?.toLowerCase() ?? ''
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return NextResponse.json(
        { error: 'Este email ya está registrado. Inicia sesión o usa “Olvidé mi contraseña”.' },
        { status: 409 },
      )
    }
    if (msg.includes('influencer_signup_') || msg.includes('database error')) {
      return NextResponse.json({ error: 'Revisa tus datos (ubicación, Instagram o fecha de nacimiento).' }, { status: 422 })
    }
    console.error('[register-influencer] createUser error:', createError?.message)
    return NextResponse.json({ error: 'No pudimos crear tu cuenta. Intenta nuevamente.' }, { status: 500 })
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('[register-influencer] generateLink error:', linkError?.message)
    return NextResponse.json({ ok: true, account_created: true, email_sent: false })
  }

  const actionLink =
    `${APP_URL}/auth/confirm` +
    `?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}` +
    `&type=magiclink&next=${encodeURIComponent('/')}`

  const { error: emailError } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    tags: [emailAudience('account')],
    subject: 'Confirma tu cuenta — SCENCE',
    html: influencerSignupConfirmEmail({ displayName, actionLink }),
  })

  if (emailError) {
    console.error('[register-influencer] Resend error:', JSON.stringify(emailError))
    return NextResponse.json({ ok: true, account_created: true, email_sent: false })
  }

  return NextResponse.json({ ok: true, account_created: true, email_sent: true })
}
