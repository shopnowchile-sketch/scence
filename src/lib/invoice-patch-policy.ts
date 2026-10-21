// Política de escritura de PATCH /api/invoices/[id] (pagos — Regla Cero).
// Pura y sin I/O para poder probarla: la ruta solo aplica el resultado.
//
// - Los campos financieros (montos, impuestos, moneda, estado, paid_at, ids de
//   organización/marca/campaña, numeración, metadata.kind/application_id) NUNCA
//   se escriben por edición genérica. Un monto mal emitido se corrige anulando
//   y emitiendo otra factura (se conserva el histórico).
// - mark_paid / void / mark_overdue son solo de admin de plataforma: una marca
//   no puede declararse pagada.
// - paid y void son estados terminales.

export const TERMINAL_INVOICE_STATUSES = ['paid', 'void'] as const
export const MUTABLE_INVOICE_STATUSES = ['draft', 'sent', 'overdue', 'partially_paid'] as const

const ADMIN_ONLY_ACTIONS = ['mark_paid', 'void', 'mark_overdue'] as const
const ACTION_KEYS: Record<string, readonly string[]> = {
  send: ['send_to', 'note'],
  mark_paid: ['payment_reference'],
  void: [],
  mark_overdue: [],
}
const EDIT_COLUMNS = ['due_date', 'issue_date', 'notes', 'terms'] as const
const EDIT_CLIENT_META = ['client_name', 'client_email', 'client_address', 'client_tax_id'] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type InvoicePatchPlan =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      kind: 'action'
      action: 'send' | 'mark_paid' | 'void' | 'mark_overdue'
      update: Record<string, unknown>
      sendTo: string | null
      note: string | null
    }
  | { ok: true; kind: 'edit'; update: Record<string, unknown>; metadataPatch: Record<string, string | null> }

const fail = (status: number, error: string): InvoicePatchPlan => ({ ok: false, status, error })

export function planInvoicePatch(
  body: Record<string, unknown>,
  ctx: { isAdmin: boolean; currentStatus: string; clientEmail: string | null; now: string },
): InvoicePatchPlan {
  if ((TERMINAL_INVOICE_STATUSES as readonly string[]).includes(ctx.currentStatus)) {
    return fail(409, 'La factura está pagada o anulada y no se puede modificar')
  }

  const action = body.action
  const keys = Object.keys(body).filter(k => k !== 'action')

  // ── Acciones de estado ──────────────────────────────────────────────────
  if (action !== undefined) {
    if (typeof action !== 'string' || !(action in ACTION_KEYS)) return fail(422, 'Acción no válida')
    const extra = keys.filter(k => !ACTION_KEYS[action].includes(k))
    if (extra.length) return fail(422, `Campos no permitidos para ${action}: ${extra.join(', ')}`)
    if ((ADMIN_ONLY_ACTIONS as readonly string[]).includes(action) && !ctx.isAdmin) {
      return fail(403, 'Solo el equipo SCENCE puede cambiar el estado de pago de una factura')
    }

    const update: Record<string, unknown> = { updated_at: ctx.now }
    let sendTo: string | null = null
    let note: string | null = null

    if (action === 'send') {
      update.status = 'sent'
      // Una marca solo puede enviar al email registrado en la factura; el
      // destinatario libre es de admin (evita usar SCENCE para enviar a terceros).
      const requested = typeof body.send_to === 'string' ? body.send_to.trim() : ''
      if (requested && !EMAIL_RE.test(requested)) return fail(422, 'El email de destino no es válido')
      sendTo = (ctx.isAdmin ? requested : '') || ctx.clientEmail
      if (body.note !== undefined && body.note !== null) {
        if (typeof body.note !== 'string' || body.note.length > 1000) return fail(422, 'La nota es demasiado larga')
        note = body.note.trim() || null
      }
    } else if (action === 'mark_paid') {
      update.status = 'paid'
      update.paid_at = ctx.now
      if (body.payment_reference !== undefined && body.payment_reference !== null && body.payment_reference !== '') {
        if (typeof body.payment_reference !== 'string' || body.payment_reference.length > 200) {
          return fail(422, 'La referencia de pago no es válida')
        }
        update.payment_reference = body.payment_reference.trim()
      }
    } else if (action === 'void') {
      update.status = 'void'
    } else {
      update.status = 'overdue'
    }
    return { ok: true, kind: 'action', action: action as 'send' | 'mark_paid' | 'void' | 'mark_overdue', update, sendTo, note }
  }

  // ── Edición genérica: solo admin, solo campos no financieros ─────────────
  if (!ctx.isAdmin) return fail(403, 'Solo el equipo SCENCE puede editar una factura')
  const allowed = [...EDIT_COLUMNS, ...EDIT_CLIENT_META] as readonly string[]
  const rejected = keys.filter(k => !allowed.includes(k))
  if (rejected.length) return fail(422, `Campos no editables: ${rejected.join(', ')}`)
  if (keys.length === 0) return fail(422, 'No hay campos para actualizar')

  const update: Record<string, unknown> = { updated_at: ctx.now }
  const metadataPatch: Record<string, string | null> = {}
  for (const key of keys) {
    const v = body[key]
    if (v !== null && typeof v !== 'string') return fail(422, `El campo ${key} debe ser texto`)
    const t = v === null ? null : v.trim() === '' ? null : v.trim()
    if (t !== null && t.length > 2000) return fail(422, `El campo ${key} es demasiado largo`)
    if ((key === 'due_date' || key === 'issue_date') && t !== null && !DATE_RE.test(t)) {
      return fail(422, `El campo ${key} debe tener formato AAAA-MM-DD`)
    }
    if ((key === 'due_date' || key === 'issue_date') && t === null) return fail(422, `El campo ${key} es obligatorio`)
    if (key === 'client_email' && t !== null && !EMAIL_RE.test(t)) return fail(422, 'El email del cliente no es válido')
    if ((EDIT_CLIENT_META as readonly string[]).includes(key)) metadataPatch[key] = t
    else update[key] = t
  }
  if ('issue_date' in update && ctx.currentStatus !== 'draft') {
    return fail(409, 'La fecha de emisión solo se puede cambiar en borradores')
  }
  return { ok: true, kind: 'edit', update, metadataPatch }
}
