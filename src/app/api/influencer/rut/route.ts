import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isValidRut, normalizeRut } from '@/lib/rut'

// RUT de la influencer: dato privado. Solo la propia influencer (sesión) lo lee y lo edita aquí;
// el servidor deriva la influencer de la sesión, nunca del cuerpo. Ver migración influencer_private_data.

async function ownInfluencerId(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from('influencers').select('id').eq('user_id', userId).maybeSingle()
  return { admin, influencerId: (data?.id as string | undefined) ?? null }
}

// GET /api/influencer/rut → { data: { rut: "12345678-5" | null } }
export async function GET() {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, influencerId } = await ownInfluencerId(user.id)
  if (!influencerId) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })
  const { data, error } = await admin.from('influencer_private_data').select('rut').eq('influencer_id', influencerId).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer tu RUT' }, { status: 500 })
  return NextResponse.json({ data: { rut: (data?.rut as string | null) ?? null } })
}

// PUT /api/influencer/rut { rut: string | null } → vacío borra el dato; si viene, debe ser un RUT chileno válido.
export async function PUT(req: Request) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, influencerId } = await ownInfluencerId(user.id)
  if (!influencerId) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const body = await req.json().catch(() => null) as { rut?: unknown } | null
  const incoming = String(body?.rut ?? '').trim()
  let rut: string | null = null
  if (incoming) {
    if (!isValidRut(incoming)) return NextResponse.json({ error: 'El RUT no es válido. Revisa el número y el dígito verificador.' }, { status: 422 })
    rut = normalizeRut(incoming)
  }
  const { error } = await admin.from('influencer_private_data')
    .upsert({ influencer_id: influencerId, rut, updated_at: new Date().toISOString() }, { onConflict: 'influencer_id' })
  if (error) {
    console.error('[influencer/rut PUT]', error.message)
    return NextResponse.json({ error: 'No se pudo guardar tu RUT. Inténtalo de nuevo.' }, { status: 500 })
  }
  return NextResponse.json({ data: { rut } })
}
