import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ensureBrandRow, resolveBrandAccess, linkPendingBrandMembership } from '@/lib/supabase/ensureOrg'

// POST /api/brand/register
// Llamado en cada carga del layout de marca (ver (brand)/layout.tsx). Red de
// seguridad idempotente: ensureBrandRow() ya crea la fila en el momento del
// registro (/api/auth/register-brand), así que en el caso normal esto es un
// no-op que solo confirma que la fila existe. Sigue siendo necesario para
// cuentas creadas antes de ese fix (2026-07-10) y como respaldo si esa
// creación temprana falló por cualquier motivo.
//
// FIX (2026-07-10, multiusuario por marca — brand_members): antes de
// aprovisionar una marca PROPIA con ensureBrandRow, hay que resolver si el
// usuario ya tiene acceso (owner o miembro activo) o si hay una invitación
// pendiente esperando su email. Sin esto, un usuario invitado (ej.
// mateluna641@gmail.com) dispararía la creación de una marca/organización
// nueva la primera vez que entra al portal, en vez de unirse a la marca a
// la que fue invitado.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existingAccess = await resolveBrandAccess(user.id)
  if (existingAccess) {
    return NextResponse.json({ data: { id: existingAccess.brandId, role: existingAccess.role } })
  }

  const linked = await linkPendingBrandMembership(user)
  if (linked) {
    const access = await resolveBrandAccess(user.id)
    if (access) return NextResponse.json({ data: { id: access.brandId, role: access.role } })
  }

  const brand = await ensureBrandRow(user)
  if (!brand) return NextResponse.json({ error: 'No se pudo preparar la cuenta de marca' }, { status: 500 })

  return NextResponse.json({ data: brand })
}
