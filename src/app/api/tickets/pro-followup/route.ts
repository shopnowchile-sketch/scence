import { NextRequest, NextResponse } from 'next/server'
import { requireSupportAdmin } from '@/lib/support-admin'
import { syncProTickets } from '@/lib/support-tickets'

// «Actualizar Pro»: crea un ticket por cada intento Pro pendiente que aún no tiene uno. NO envía correos.
// { dry_run: true } solo cuenta, para confirmar antes de crear.
export async function POST(request: NextRequest) {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  let body: { dry_run?: boolean } = {}
  try { body = await request.json() } catch { /* sin cuerpo = crear */ }
  const result = await syncProTickets(auth.admin, auth.orgId, { dryRun: body.dry_run === true })
  if (result.error) return NextResponse.json({ error: result.error, ...result }, { status: 500 })
  return NextResponse.json(result)
}
