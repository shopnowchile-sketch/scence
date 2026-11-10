// Respuesta de un admin a un ticket: guarda en el historial, pasa Abierto → En progreso (nunca toca
// un ticket en progreso o cerrado) y envía el correo por Resend dejando el resultado en la respuesta.
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyContactOfSupportReply } from '@/lib/support-notifications'
import { renderTemplate, planUrl } from '@/lib/support-tickets'

type Admin = SupabaseClient<any, any, any>

export async function resolveTicketContact(admin: Admin, createdBy: string | null) {
  if (!createdBy) return null
  const [{ data: influencer }, { data: brand }, authResult] = await Promise.all([
    admin.from('influencers').select('display_name, email').eq('user_id', createdBy).maybeSingle(),
    admin.from('brands').select('contact_name, contact_email, name').eq('user_id', createdBy).maybeSingle(),
    admin.auth.admin.getUserById(createdBy),
  ])
  const email = influencer?.email ?? brand?.contact_email ?? authResult.data.user?.email ?? ''
  const name = influencer?.display_name ?? brand?.contact_name ?? brand?.name ?? authResult.data.user?.user_metadata?.full_name ?? email
  return { email, name, portal: (influencer ? 'influencer' : 'brand') as 'influencer' | 'brand' }
}

/** Envía el correo de una respuesta ya guardada y registra el resultado en ella. Nunca lanza. */
export async function deliverReplyEmail(admin: Admin, input: { ticketId: string; replyId: string; actorId: string; message: string }) {
  let status: 'sent' | 'failed' = 'failed'
  let error: string | null = null
  try {
    const { data: ticket } = await admin.from('tickets').select('title, created_by').eq('id', input.ticketId).single()
    if (!ticket?.created_by || ticket.created_by === input.actorId) { error = 'El ticket no tiene un contacto al que escribir.' }
    else {
      const contact = await resolveTicketContact(admin, ticket.created_by)
      if (!contact?.email) error = 'El contacto no tiene correo.'
      else {
        const id = await notifyContactOfSupportReply({ contactEmail: contact.email, contactName: contact.name, ticketTitle: ticket.title, message: input.message, portal: contact.portal })
        if (id) status = 'sent'
        else error = 'No se envió: el destinatario fue omitido (influencer inactiva).'
      }
    }
  } catch (e) { error = e instanceof Error ? e.message : 'Error al enviar' }
  const { error: updateError } = await admin.from('ticket_replies').update({ email_status: status, email_error: error }).eq('id', input.replyId)
  if (updateError) console.error('[ticket-reply] no se pudo guardar el resultado del correo', updateError)
  return { status, error }
}

/** Guarda la respuesta y pasa Abierto → En progreso. No envía el correo. */
export async function saveAdminReply(admin: Admin, input: { ticketId: string; userId: string; message: string }) {
  const { data, error } = await admin.from('ticket_replies').insert({ ticket_id: input.ticketId, user_id: input.userId, message: input.message, is_admin: true }).select().single()
  if (error) return { reply: null, error: error.message }
  // Solo Abierto → En progreso: un ticket en progreso o cerrado no cambia.
  await admin.from('tickets').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', input.ticketId).eq('status', 'open')
  return { reply: data as { id: string }, error: null }
}

export const DUPLICATE_WINDOW_DAYS = 7

/** Respuesta múltiple con plantilla: confirma por ticket, omite cerrados y repetidos, nunca duplica. */
export async function bulkReply(admin: Admin, input: { orgId: string; userId: string; ticketIds: string[]; template: string; now?: Date }) {
  const now = input.now ?? new Date()
  const ids = Array.from(new Set(input.ticketIds.filter(Boolean)))
  const { data: tickets } = await admin.from('tickets').select('id, status, created_by').eq('organization_id', input.orgId).in('id', ids)
  const byId = new Map((tickets ?? []).map(t => [t.id as string, t]))
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86400000).toISOString()
  const results: Array<{ ticket_id: string; status: 'sent' | 'failed' | 'skipped'; reason?: string | null }> = []

  for (const id of ids) {
    const t = byId.get(id)
    if (!t) { results.push({ ticket_id: id, status: 'skipped', reason: 'No encontrado' }); continue }
    if (t.status === 'closed') { results.push({ ticket_id: id, status: 'skipped', reason: 'Ticket cerrado' }); continue }
    const contact = await resolveTicketContact(admin, t.created_by ?? null)
    const message = renderTemplate(input.template, { nombre: contact?.name ?? '', plan_url: planUrl() }).trim()
    if (!message) { results.push({ ticket_id: id, status: 'skipped', reason: 'Mensaje vacío' }); continue }
    const { data: prior } = await admin.from('ticket_replies').select('id').eq('ticket_id', id).eq('is_admin', true).eq('message', message).gte('created_at', since).limit(1)
    if (prior?.length) { results.push({ ticket_id: id, status: 'skipped', reason: 'Ya se envió este mensaje' }); continue }
    const saved = await saveAdminReply(admin, { ticketId: id, userId: input.userId, message })
    if (!saved.reply) { results.push({ ticket_id: id, status: 'failed', reason: saved.error }); continue }
    const sent = await deliverReplyEmail(admin, { ticketId: id, replyId: saved.reply.id, actorId: input.userId, message })
    results.push({ ticket_id: id, status: sent.status, reason: sent.error })
  }
  return results
}
