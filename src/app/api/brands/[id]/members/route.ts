import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'

type Params = { params: { id: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// Vista admin de "quiénes tienen acceso al portal de esta marca" — mismo
// listado que ve la marca en /api/brand/members (owner + brand_members),
// pero scopeado por brand_id de la URL en vez del brandId del viewer, para
// que el admin pueda ver el equipo de CUALQUIER marca. Reutiliza la misma
// forma de respuesta (owner sintético + filas de brand_members) que ya usa
// el portal marca — no se duplica lógica de negocio, solo el scope.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const [
    { data: members, error: membersError },
    { data: brand, error: brandError },
  ] = await Promise.all([
    admin
      .from('brand_members')
      .select('id, email, role, invited_at, joined_at, is_active')
      .eq('brand_id', params.id)
      .order('invited_at', { ascending: false }),
    admin
      .from('brands')
      .select('user_id, contact_email, created_at')
      .eq('id', params.id)
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

function memberResendEmail({ brandName, actionLink }: { brandName: string; actionLink: string }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Tu link de acceso</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Tu link de acceso 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Aquí tienes un nuevo link para ingresar al portal de marca de <strong style="color:#111827">${brandName}</strong> en Scence.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Ingresar al portal →
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

// POST /api/brands/[id]/members — reenviar el email de login a un miembro del
// equipo (brand_members). Para el owner (fila sintética "owner-...") el
// frontend usa /api/brands/[id]/invite directamente, que ya cubre ese caso;
// esta ruta es solo para filas reales de brand_members.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { member_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const memberId = body.member_id
  if (!memberId) return NextResponse.json({ error: 'member_id requerido' }, { status: 400 })

  const admin = createAdminClient()

  const [
    { data: member, error: memberErr },
    { data: brand, error: brandErr },
  ] = await Promise.all([
    admin
      .from('brand_members')
      .select('id, email, is_active')
      .eq('id', memberId)
      .eq('brand_id', params.id)
      .maybeSingle(),
    admin
      .from('brands')
      .select('id, name')
      .eq('id', params.id)
      .maybeSingle(),
  ])

  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 })
  if (!member) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  if (brandErr || !brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!member.is_active) return NextResponse.json({ error: 'Este usuario está desactivado' }, { status: 422 })

  // Crear/reutilizar el usuario de Auth — mismo patrón que POST /api/brand/members.
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find(u => u.email === member.email)

  if (!existingUser) {
    await admin.auth.admin.createUser({
      email: member.email,
      email_confirm: true,
      user_metadata: { is_brand: true, full_name: member.email.split('@')[0] },
    })
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: member.email,
    options: { redirectTo: `${APP_URL}/brand-dash` },
  })

  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? 'No se pudo generar el link' }, { status: 500 })
  }

  const actionLink = `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`

  const { error: emailErr } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: member.email,
    subject: `Tu link de acceso al portal de ${brand.name} — Scence`,
    html: memberResendEmail({ brandName: brand.name, actionLink }),
  })

  return NextResponse.json({
    message: !emailErr ? `Email reenviado a ${member.email}` : 'Link generado (email falló — usa el link directo)',
    email_sent: !emailErr,
    action_link: actionLink,
  })
}
