import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ensureBrandRow } from '@/lib/supabase/ensureOrg'

// POST /api/brand/register
// Llamado en cada carga del layout de marca (ver (brand)/layout.tsx). Red de
// seguridad idempotente: ensureBrandRow() ya crea la fila en el momento del
// registro (/api/auth/register-brand), así que en el caso normal esto es un
// no-op que solo confirma que la fila existe. Sigue siendo necesario para
// cuentas creadas antes de ese fix (2026-07-10) y como respaldo si esa
// creación temprana falló por cualquier motivo.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const brand = await ensureBrandRow(user)
  if (!brand) return NextResponse.json({ error: 'No se pudo preparar la cuenta de marca' }, { status: 500 })

  return NextResponse.json({ data: brand })
}
