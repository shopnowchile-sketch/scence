import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'
import { isUuid } from '@/lib/locations'
import { loadPerformanceMap } from '@/lib/influencer-performance'

export const dynamic = 'force-dynamic'

// GET /api/influencers/[id]/performance — desempeño interno (campañas, asistencia, entregables, cumplimiento).
// Solo Super Admin: es información interna de SCENCE; las marcas no la ven. Todo se calcula desde datos reales.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  try {
    const perf = (await loadPerformanceMap(admin, [params.id], { withHistory: true })).get(params.id)
    return NextResponse.json({ data: perf })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo calcular el desempeño' }, { status: 500 })
  }
}
