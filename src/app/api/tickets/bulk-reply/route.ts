import { NextRequest, NextResponse } from 'next/server'
import { requireSupportAdmin } from '@/lib/support-admin'
import { bulkReply } from '@/lib/ticket-reply'

export const maxDuration = 120
const MAX_TICKETS = 50

// Respuesta con plantilla a varios tickets. Solo se llama desde la confirmación de la pantalla.
export async function POST(request: NextRequest) {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  let body: { ticket_ids?: string[]; message?: string; confirm?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }
  if (body.confirm !== true) return NextResponse.json({ error: 'Falta la confirmación explícita.' }, { status: 422 })
  const ids = Array.from(new Set((body.ticket_ids ?? []).filter(Boolean)))
  const message = String(body.message ?? '').trim()
  if (!ids.length) return NextResponse.json({ error: 'Selecciona al menos un ticket.' }, { status: 422 })
  if (ids.length > MAX_TICKETS) return NextResponse.json({ error: `Máximo ${MAX_TICKETS} tickets por envío.` }, { status: 422 })
  if (!message || message.length > 5000) return NextResponse.json({ error: 'Ingresa un mensaje válido.' }, { status: 422 })
  const results = await bulkReply(auth.admin, { orgId: auth.orgId, userId: auth.userId, ticketIds: ids, template: message })
  return NextResponse.json({
    ok: true,
    sent: results.filter(r => r.status === 'sent').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  })
}
