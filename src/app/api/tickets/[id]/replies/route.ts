import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { saveAdminReply, deliverReplyEmail } from '@/lib/ticket-reply'
import { renderTemplate, planUrl } from '@/lib/support-tickets'
import { waitUntil } from '@vercel/functions'

type Params = { params: { id: string } }

// ── GET /api/tickets/[id]/replies ─────────────────────────────────────────────
// Accesible para: admin (por org) o dueño del ticket (created_by)
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verificar acceso: admin de la org o dueño del ticket
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  let hasAccess = false
  let viewerIsAdmin = false
  if (orgId && (await getUserRole(user.id, orgId, admin)).isAdmin) {
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('id', params.id)
      .eq('organization_id', orgId)
      .single()
    if (ticket) { hasAccess = true; viewerIsAdmin = true }
  }

  if (!hasAccess) {
    // Fallback: dueño del ticket
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('id', params.id)
      .eq('created_by', user.id)
      .single()
    if (ticket) hasAccess = true
  }

  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('ticket_replies')
    .select(viewerIsAdmin ? 'id, message, is_admin, user_id, created_at, email_status, email_error' : 'id, message, is_admin, user_id, created_at')
    .eq('ticket_id', params.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// ── POST /api/tickets/[id]/replies ────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { message?: string } = {}
  try { body = await request.json() } catch { /* ok */ }

  if (!body.message?.trim()) return NextResponse.json({ error: 'El mensaje es requerido' }, { status: 422 })
  const message = body.message.trim()

  const admin = createAdminClient()

  // Verificar acceso al ticket
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  let isAdmin = false

  if (orgId && (await getUserRole(user.id, orgId, admin)).isAdmin) {
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('id', params.id)
      .eq('organization_id', orgId)
      .single()
    if (ticket) isAdmin = true
  }

  if (!isAdmin) {
    // Verificar que es el dueño del ticket
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('id', params.id)
      .eq('created_by', user.id)
      .single()
    if (!ticket) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isAdmin) {
    const { data, error } = await admin.from('ticket_replies').insert({ ticket_id: params.id, user_id: user.id, message, is_admin: false }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  }

  // Admin: guarda, pasa Abierto → En progreso y envía el correo dejando el resultado en la respuesta.
  const finalMessage = renderTemplate(message, { plan_url: planUrl() })
  const saved = await saveAdminReply(admin, { ticketId: params.id, userId: user.id, message: finalMessage })
  if (!saved.reply) return NextResponse.json({ error: saved.error }, { status: 500 })
  waitUntil(deliverReplyEmail(admin, { ticketId: params.id, replyId: saved.reply.id, actorId: user.id, message: finalMessage }))
  const data = saved.reply

  return NextResponse.json({ data }, { status: 201 })
}
