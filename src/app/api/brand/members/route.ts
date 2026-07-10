import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandAccess, type BrandAccess } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

const MEMBER_ROLES = ['brand_manager', 'finance', 'member'] as const

function brandMemberInviteEmail({ brandName, actionLink }: { brandName: string; actionLink: string }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invitación a Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Te invitaron a un equipo 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Te invitaron a acceder al portal de marca de <strong style="color:#111827">${brandName}</strong> en Scence.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Acceder al portal →
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

// Gestionar el equipo (invitar/desactivar) queda reservado al owner de la
// marca — spec Pri no extiende esto a brand_manager en esta ronda.
async function getOwnerBrand() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !user.user_metadata?.is_brand) return { user: null, brand: null }

  const admin = createAdminClient()
  const { data: brand } = await admin
    .from('brands')
    .select('id, organization_id, name')
    .eq('user_id', user.id)
    .single()

  return { user, brand: brand ?? null }
}

// Ver el equipo sí está disponible para owner o cualquier miembro activo
// (brand_manager/finance/member) — solo lectura.
async function getViewerAccess(): Promise<{ userId: string; access: BrandAccess } | null> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || !user.user_metadata?.is_brand) return null

  const access = await resolveBrandAccess(user.id)
  if (!access) return null

  return { userId: user.id, access }
}

// GET /api/brand/members — lista de usuarios con acceso a la marca
export async function GET() {
  const viewer = await getViewerAccess()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('brand_members')
    .select('id, email, role, invited_at, joined_at, is_active')
    .eq('brand_id', viewer.access.brandId)
    .order('invited_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Owner siempre primero (sort estable: mantiene el orden por invited_at desc
  // dentro de cada grupo) — mismo criterio que ya usa /api/settings/team con is_owner.
  const sorted = (data ?? []).slice().sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1
    if (a.role !== 'owner' && b.role === 'owner') return 1
    return 0
  })

  return NextResponse.json({ data: sorted })
}

// POST /api/brand/members — invitar nuevo usuario (solo owner)
// Roles mínimos: brand_manager, finance, member (spec Pri 2026-07-10). Crea
// la fila de invitación en brand_members y, a diferencia de la versión
// anterior, envía el email de invitación y crea/reutiliza el usuario de
// Auth — mismo patrón token_hash ya validado en /api/brands/[id]/invite.
export async function POST(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { email?: string; role?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const email = (body.email ?? '').trim().toLowerCase()
  const role = body.role ?? 'member'
  if (!email) return NextResponse.json({ error: 'Email requerido' }, { status: 400 })
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Insertar en brand_members (invitación pendiente)
  const { data, error } = await admin
    .from('brand_members')
    .insert({
      brand_id:   brand.id,
      email,
      role,
      invited_by: user.id,
    })
    .select('id, email, role, invited_at, joined_at, is_active')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Este email ya fue invitado' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enviar invitación por email. No bloqueante: si falla, la fila de
  // invitación ya quedó creada — el owner puede reintentar reenviando (borra
  // y vuelve a invitar) o el admin puede resolverlo a mano.
  let emailSent = false
  try {
    const { data: existingUsers } = await admin.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find(u => u.email === email)

    if (!existingUser) {
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { is_brand: true, full_name: email.split('@')[0] },
      })
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${APP_URL}/brand-dash` },
    })

    if (!linkErr && linkData?.properties?.hashed_token) {
      const actionLink = `${APP_URL}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/brand-dash`
      const { error: emailErr } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `Invitación al portal de ${brand.name} — Scence`,
        html: brandMemberInviteEmail({ brandName: brand.name, actionLink }),
      })
      emailSent = !emailErr
    }
  } catch (e) {
    console.error('[POST /api/brand/members] invite email error:', e)
  }

  return NextResponse.json({ data: { ...data, email_sent: emailSent } }, { status: 201 })
}

// DELETE /api/brand/members?id=... — desactivar miembro (solo owner)
export async function DELETE(request: NextRequest) {
  const { user, brand } = await getOwnerBrand()
  if (!user || !brand) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberId = request.nextUrl.searchParams.get('id')
  if (!memberId) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('brand_members')
    .update({ is_active: false })
    .eq('id', memberId)
    .eq('brand_id', brand.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
