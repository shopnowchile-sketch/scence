import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ensureBrandRow } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL, brandSignupConfirmEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

export async function POST(req: NextRequest) {
  let body: {
    brand_name?: string
    contact_name?: string
    email?: string
    password?: string
    referred_by_instagram?: string
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
  // "¿Quién te invitó?" — opcional, viene del formulario en /register
  // (RegisterForm.tsx). Se guarda tal cual en user_metadata; ensureBrandRow()
  // ya se encarga de normalizarlo (sin @, minúsculas) al copiarlo a
  // brands.metadata. /register/brand (BrandRegisterForm.tsx) no tiene este
  // campo, así que acá siempre puede venir vacío — eso es válido.
  const referredByInstagram = (body.referred_by_instagram ?? '').trim() || null

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
      referred_by_instagram: referredByInstagram,
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

  // FIX (2026-07-10): crear la fila en `brands` (+ organización propia) ACÁ,
  // inmediatamente después de crear el auth user — no esperar al primer
  // login. Root cause confirmado por SQL: fmicchile@gmail.com (Empresa1)
  // quedó en auth.users sin fila de marca porque el email de confirmación no
  // se abrió y nadie llegó a /brand-dash a disparar /api/brand/register. Con
  // esto, la marca es visible en /admin-brands como pending_approval desde
  // este punto, sin depender de que el correo llegue o se confirme.
  // ensureBrandRow() es la misma función que usa /api/brand/register — no se
  // duplica lógica (ver ensureOrg.ts).
  const brandRow = await ensureBrandRow(newUser.user)
  if (!brandRow) {
    // La cuenta de Auth ya existe — no la borramos (podría dejar un estado
    // peor, y el admin igual puede repararla a mano). Se loguea para
    // investigar, pero seguimos: es mejor tener el usuario sin fila de marca
    // (recuperable) que responder un error genérico que sugiera que nada se
    // creó.
    console.error('[register-brand] ensureBrandRow devolvió null para', email, '— revisar logs de ensureOrg/ensureBrandRow')
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
          referred_by_instagram: referredByInstagram,
        },
      },
    })

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('[register-brand] generateLink error:', linkError?.message)

    // FIX (2026-07-10, punto B del fix): la cuenta y la fila de marca YA
    // existen (creadas arriba) — esto NO es un fallo total del registro,
    // solo del envío del correo. Antes se respondía 500 con { error }, lo
    // que el formulario interpreta como "no se creó nada" y deja a la marca
    // sin ninguna vía de recuperación visible salvo contacto manual. Ahora:
    // 200 + email_sent:false, la marca queda pending_approval y visible en
    // /admin-brands, y un admin puede reenviarle el acceso con el botón
    // "Invitar acceso" que ya existe (POST /api/brands/[id]/invite).
    return NextResponse.json({
      ok: true,
      account_created: true,
      email_sent: false,
      brand_id: brandRow?.id ?? null,
    })
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
    // Mismo criterio que el fallo de generateLink de arriba — cuenta y fila
    // de marca ya existen, no es un fallo total.
    console.error('[register-brand] Resend error:', JSON.stringify(emailError))

    return NextResponse.json({
      ok: true,
      account_created: true,
      email_sent: false,
      brand_id: brandRow?.id ?? null,
    })
  }

  return NextResponse.json({ ok: true, account_created: true, email_sent: true, brand_id: brandRow?.id ?? null })
}
