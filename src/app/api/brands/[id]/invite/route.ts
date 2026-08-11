import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

async function requirePlatformAdmin(user: { id: string; user_metadata: Record<string, unknown> }, admin: ReturnType<typeof createAdminClient>) {
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const role = orgId ? await getUserRole(user.id, orgId, admin) : null
  return Boolean(role?.isAdmin)
}

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
  if (!await requirePlatformAdmin(user, admin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: brand, error: brandErr } = await admin
    .from('brands')
    .select('id, name, contact_email, contact_name, user_id, organization_id, status')
    .eq('id', params.id)
    .single()

  if (brandErr || !brand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  if (brand.status !== 'approved') {
    return NextResponse.json({ error: 'La marca debe ser aprobada antes de invitar a su owner.' }, { status: 409 })
  }

  if (!brand.contact_email) {
    return NextResponse.json(
      { error: 'La marca no tiene email de contacto. Agrégalo antes de invitar.' },
      { status: 422 }
    )
  }

  const contactEmail = brand.contact_email.trim().toLowerCase()

  // Búsqueda paginada de auth.users por email. Con >1.6k usuarios,
  // admin.auth.admin.listUsers() SIN paginar solo trae la primera página
  // (perPage default bajo) — puede no encontrar una cuenta que sí existe y
  // arriesgar crear un duplicado más abajo. Mismo patrón ya usado en
  // crm-leads/[id]/route.ts.
  async function findAuthUserByEmail(email: string) {
    let page = 1
    const perPage = 1000
    for (;;) {
      const { data: usersPage, error: usersErr } = await admin.auth.admin.listUsers({ page, perPage })
      if (usersErr || !usersPage?.users?.length) return null
      const match = usersPage.users.find(u => u.email?.toLowerCase() === email)
      if (match) return match
      if (usersPage.users.length < perPage) return null
      page++
    }
  }

  // ── Ya tiene cuenta vinculada (brands.user_id) → reenviar magic link ─────────
  // FIX (bug Limitless, 2026-07-13): antes esta rama llamaba generateLink con
  // brand.contact_email SIN verificar que coincidiera con el email real del
  // owner en auth.users. Si el email de contacto se había editado desde el
  // admin y NO se había sincronizado auth.users todavía (el bug del PATCH),
  // generateLink no encontraba ningún usuario con ese email y Supabase creaba
  // uno NUEVO en silencio — brands.user_id seguía apuntando al usuario viejo,
  // y el usuario nuevo (logueado de verdad) no encontraba su marca. Ahora se
  // verifica primero que auth.users.email del owner coincida con
  // contact_email; si no coincide, se detiene y pide sincronizar desde la
  // edición de marca. Nunca se llama a un método que pueda crear otra cuenta.
  if (brand.user_id) {
    const { data: ownerAuth, error: ownerAuthErr } = await admin.auth.admin.getUserById(brand.user_id)

    if (ownerAuthErr || !ownerAuth?.user) {
      console.error('[POST /api/brands/[id]/invite] owner auth user no encontrado:', ownerAuthErr?.message)
      return NextResponse.json({ error: 'Usuario de autenticación del owner no encontrado' }, { status: 404 })
    }

    const currentAuthEmail = ownerAuth.user.email?.trim().toLowerCase() ?? null

    if (currentAuthEmail !== contactEmail) {
      return NextResponse.json(
        {
          error:
            'El correo de contacto no coincide con el correo de acceso del owner. Sincronízalo primero editando la marca antes de reenviar la invitación.',
        },
        { status: 409 },
      )
    }

    // Merge de metadata (no reemplazo) — antes esto pisaba user_metadata
    // completo, arriesgando perder organization_id u otros campos que
    // ensureOrg() ya le hubiera fijado al usuario.
    await admin.auth.admin.updateUserById(brand.user_id, {
      user_metadata: { ...ownerAuth.user.user_metadata, is_brand: true, brand_id: params.id },
    })

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: contactEmail,
      options: {
        redirectTo: `${APP_URL}/brand-dash`,
        data: { is_brand: true, brand_id: params.id },
      },
    })

    if (linkErr) {
      console.error('[POST /api/brands/[id]/invite] generateLink falló:', linkErr.message)
      return NextResponse.json({ error: 'No se pudo generar el link de acceso' }, { status: 500 })
    }

    // token_hash en vez de action_link (PKCE) — mismo fix ya validado en
    // producción para el invite de influencers (api/influencers/[id]/invite).
    const actionLink = linkData?.properties?.hashed_token
      ? `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`
      : null
    let emailSent = false
    if (actionLink) {
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: contactEmail,
        subject: 'Tu link de acceso a Scence',
        html: brandInviteEmail({ name: brand.contact_name ?? brand.name, actionLink, isResend: true }),
      })
      emailSent = !emailErr
    }

    return NextResponse.json({
      message: emailSent
        ? `Email reenviado a ${contactEmail}`
        : `Link generado (email falló — usa el link directo)`,
      already_linked: true,
      email_sent: emailSent,
      action_link: actionLink,
    })
  }

  // ── Sin cuenta vinculada todavía → crear o vincular auth user ────────────────
  const existingUser = await findAuthUserByEmail(contactEmail)

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
      email: contactEmail,
      email_confirm: true,
      user_metadata: {
        is_brand: true,
        brand_id: params.id,
        full_name: brand.contact_name ?? brand.name,
      },
    })
    if (createErr || !newUser?.user) {
      console.error('[POST /api/brands/[id]/invite] createUser falló:', createErr?.message)
      return NextResponse.json({ error: 'No se pudo crear el usuario de acceso' }, { status: 500 })
    }
    authUserId = newUser.user.id
  }

  // Vincular user_id en la fila de brands
  const { error: linkBrandErr } = await admin.from('brands').update({ user_id: authUserId }).eq('id', params.id)
  if (linkBrandErr) {
    console.error('[POST /api/brands/[id]/invite] no se pudo vincular user_id a la marca:', linkBrandErr.message)
    return NextResponse.json({ error: 'No se pudo vincular el usuario a la marca' }, { status: 500 })
  }

  // Generar magic link
  const { data: linkData, error: inviteErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: contactEmail,
    options: {
      redirectTo: `${APP_URL}/brand-dash`,
      data: { is_brand: true, brand_id: params.id },
    },
  })

  if (inviteErr || !linkData?.properties?.hashed_token) {
    console.error('[POST /api/brands/[id]/invite] generateLink falló en primer invite:', inviteErr?.message)
    return NextResponse.json({
      message: `Usuario creado. Email falló — usa "Olvidé mi contraseña" con ${contactEmail}.`,
      user_id: authUserId,
      email_sent: false,
    })
  }

  // token_hash en vez de action_link (PKCE) — ver comentario en la rama de
  // reenvío más arriba.
  const actionLink = `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: contactEmail,
    subject: `Bienvenido al portal de marcas — ${brand.name}`,
    html: brandInviteEmail({
      name: brand.contact_name ?? brand.name,
      actionLink,
      isResend: false,
    }),
  })

  return NextResponse.json({
    message: !emailErr
      ? `Invitación enviada a ${contactEmail}`
      : `Usuario creado. Email falló — comparte el link manualmente.`,
    user_id: authUserId,
    email_sent: !emailErr,
    action_link: actionLink,
  })
}
