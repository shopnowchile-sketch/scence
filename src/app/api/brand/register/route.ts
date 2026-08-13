import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { resolveBrandAccess, linkPendingBrandMembership } from '@/lib/supabase/ensureOrg'

// POST /api/brand/register
// Llamado en cada carga del layout de marca (ver (brand)/layout.tsx). Red de
// seguridad idempotente: /api/auth/register-brand crea la organización,
// marca y membresía oficial. Esta ruta solo confirma el acceso existente o
// termina de vincular una invitación pendiente; nunca crea autorización a
// partir de metadata ni de campos legacy.
//
// Las invitaciones antiguas todavía se descubren en brand_members como dato
// de bootstrap, pero linkPendingBrandMembership crea organization_members
// antes de que resolveBrandAccess pueda autorizar la request.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const existingAccess = await resolveBrandAccess(user.id)
  if (existingAccess) {
    return NextResponse.json({ data: { id: existingAccess.brandId, role: existingAccess.role } })
  }

  const linked = await linkPendingBrandMembership(user)
  if (linked) {
    const access = await resolveBrandAccess(user.id)
    if (access) return NextResponse.json({ data: { id: access.brandId, role: access.role } })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
