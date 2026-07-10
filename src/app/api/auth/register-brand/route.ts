import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, brandSignupConfirmEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

export async function POST(req: NextRequest) {
  let body: {
    brand_name?: string
    contact_name?: string
    email?: string
    password?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const brandName = (body.brand_name ?? '').trim()
  const contactName = (body.contact_name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''

  if (brandName.length < 2) {
    return NextResponse.json({ error: 'Nombre de marca inválido' }, { status: 422 })
  }

  if (contactName.length < 2) {
    return NextResponse.json({ error: 'Nombre de contacto inválido' }, { status: 422 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 422 })
  }

  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return NextResponse.json(
      { error: 'La contraseña no cumple los requisitos mínimos' },
      { status: 422 },
    )
  }

  const admin = createAdminClient()

  /*
   * No buscamos ni modificamos usuarios existentes.
   * createUser devuelve error si el email ya está registrado.
   * Esto evita que un endpoint público pueda reemplazar la contraseña
   * o metadata de una cuenta invitada o pendiente.
   */
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      is_brand: true,
      full_name: contactName,
      brand_name: brandName,
      organization_name: brandName,
    },
  })

  if (createError || !newUser?.user) {
    const duplicate =
      createError?.message?.toLowerCase().includes('already') ||
      createError?.message?.toLowerCase().includes('registered') ||
      createError?.message?.toLowerCase().includes('exists')

    if (duplicate) {
      return NextResponse.json(
        {
          error:
            'Este email ya está registrado. Inicia sesión o usa “Olvidé mi contraseña”.',
        },
        { status: 409 },
      )
    }

    console.error('[register-brand] createUser error:', createError?.message)

    return NextResponse.json(
      { error: 'No pudimos crear tu cuenta. Intenta nuevamente.' },
      { status: 500 },
    )
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${APP_URL}/brand-dash`,
        data: {
          is_brand: true,
          full_name: contactName,
          brand_name: brandName,
          organization_name: brandName,
        },
      },
    })

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('[register-brand] generateLink error:', linkError?.message)

    return NextResponse.json(
      {
        error:
          'La cuenta fue creada, pero no pudimos enviar la confirmación. Contáctanos para reenviar el acceso.',
      },
      { status: 500 },
    )
  }

  const actionLink =
    `${APP_URL}/auth/confirm` +
    `?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}` +
    `&type=magiclink` +
    `&next=${encodeURIComponent('/brand-dash')}`

  const { error: emailError } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Confirma tu cuenta — SCENCE',
    html: brandSignupConfirmEmail({
      contactName,
      actionLink,
    }),
  })

  if (emailError) {
    console.error('[register-brand] Resend error:', emailError)

    return NextResponse.json(
      {
        error:
          'La cuenta fue creada, pero el correo no pudo enviarse. Contáctanos para reenviar el acceso.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
