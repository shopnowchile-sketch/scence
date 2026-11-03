import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

// Solo lectura, solo Super Admin: el RUT de una influencer es dato privado (tabla influencer_private_data, solo service role).
// La propia influencer lo edita en /api/influencer/rut. Las marcas no tienen acceso (403).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await admin.from('influencer_private_data').select('rut').eq('influencer_id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer el RUT' }, { status: 500 })
  return NextResponse.json({ data: { rut: (data?.rut as string | null) ?? null } })
}
