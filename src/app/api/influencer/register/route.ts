import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ensureInfluencerRow } from '@/lib/supabase/ensureOrg'

// POST /api/influencer/register
// Llamado en el primer login de un creador recién auto-registrado (/register).
// Crea el registro en 'influencers' si no existe y lo asigna a la
// organización real (Scence SpA), no a la organización huérfana que el
// trigger de DB `handle_new_user()` crea por error en cada signup (ver B-18).
// Lógica compartida con (influencer)/layout.tsx en ensureInfluencerRow().
//
// Este endpoint es el fix de ENTRADA AL PORTAL (mismo patrón que
// /api/brand/register, que ya resuelve el caso análogo para marcas). No
// corrige el trigger en sí ni repara cuentas históricas — eso queda para una
// auditoría y migración aparte, aprobada por separado.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_influencer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const influencer = await ensureInfluencerRow(user)
  if (!influencer) return NextResponse.json({ error: 'No se pudo crear/verificar el registro de influencer' }, { status: 500 })

  return NextResponse.json({ data: influencer })
}
