// Soporte (2026-11-10): orden/filtros, Seguimiento Pro como tickets, plantillas y respuesta múltiple.
// Sin red ni correos reales: base en memoria + sumidero de Resend (entorno no productivo).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const st = await import('../src/lib/support-tickets.ts')
const tr = await import('../src/lib/ticket-reply.ts')

const ORG = 'org-1'
const NOW = new Date('2026-11-10T15:00:00Z')
type Row = Record<string, any>

function db(seed: Record<string, Row[]>, opts: { uniqueProOpen?: boolean } = {}) {
  const t: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  let n = 0
  const get = (row: Row, col: string) => col.includes('->>') ? (row[col.split('->>')[0]] ?? {})[col.split('->>')[1]] : row[col]
  const admin: any = {
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let mode: 'select' | 'insert' | 'update' = 'select'
      let payload: Row = {}
      let single = false
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filters.push(r => get(r, c) === v); return q },
        in: (c: string, vs: any[]) => { filters.push(r => vs.includes(get(r, c))); return q },
        gte: (c: string, v: any) => { filters.push(r => get(r, c) >= v); return q },
        order: () => q, limit: () => q,
        single: () => { single = true; return q },
        maybeSingle: () => { single = true; return q },
        insert: (row: Row) => { mode = 'insert'; payload = row; return q },
        update: (row: Row) => { mode = 'update'; payload = row; return q },
        then: (resolve: any) => {
          const rows = (t[table] ??= [])
          if (mode === 'insert') {
            if (opts.uniqueProOpen && table === 'tickets' && payload.category === 'pro_followup' &&
              rows.some(r => r.category === 'pro_followup' && r.created_by === payload.created_by && r.status !== 'closed')) {
              return resolve({ data: null, error: { code: '23505', message: 'dup' } })
            }
            const row = { id: `${table}-${++n}`, created_at: NOW.toISOString(), ...payload }
            rows.push(row)
            return resolve({ data: single ? row : [row], error: null })
          }
          const matched = rows.filter(r => filters.every(f => f(r)))
          if (mode === 'update') { matched.forEach(r => Object.assign(r, payload)); return resolve({ data: matched, error: null }) }
          return resolve({ data: single ? (matched[0] ?? null) : matched, error: null })
        },
      }
      return q
    },
  }
  return { admin, t }
}

const inf = (id: string, extra: Row = {}) => ({ id, user_id: `u-${id}`, display_name: `Inf ${id}`, email: `${id}@example.test`, organization_id: ORG, is_active: true, metadata: {}, ...extra })
const attempt = (id: string) => ({ status: 'incomplete', organization_id: ORG, metadata: { influencer_id: id, account_type: 'influencer' }, paypal_payer_id: null })
const ticket = (id: string, extra: Row = {}) => ({ id, organization_id: ORG, created_by: `u-${id.replace('t-', '')}`, title: 'Ticket', description: 'texto', status: 'open', priority: 'P2', category: 'other', ...extra })

// ── plantillas ─────────────────────────────────────────────────────────────
test('renderTemplate reemplaza nombre y enlace al plan', () => {
  assert.equal(st.renderTemplate('Hola {{nombre}}: {{ plan_url }}', { nombre: 'Ana', plan_url: 'https://x/p' }), 'Hola Ana: https://x/p')
  assert.match(st.planUrl('https://app.test'), /^https:\/\/app\.test\/inf-profile\?tab=plan$/)
})

// ── Seguimiento Pro: crear sin duplicar ────────────────────────────────────
test('Actualizar Pro: dry run solo cuenta; crear no envía correos y es idempotente', async () => {
  const { admin, t } = db({
    influencers: [inf('a'), inf('b'), inf('c', { user_id: null }), inf('d', { metadata: { manual_pro: { active: true } } })],
    subscriptions: [attempt('a'), attempt('b'), attempt('c'), attempt('d')],
    tickets: [], ticket_replies: [],
  }, { uniqueProOpen: true })
  const dry = await st.syncProTickets(admin, ORG, { dryRun: true })
  assert.deepEqual({ created: dry.created, existing: dry.existing, without_account: dry.without_account }, { created: 2, existing: 0, without_account: 1 })
  assert.equal(t.tickets.length, 0, 'el dry run no escribe')
  const first = await st.syncProTickets(admin, ORG)
  assert.equal(first.created, 2)
  assert.equal(t.tickets.length, 2)
  assert.ok(t.tickets.every(x => x.category === 'pro_followup' && x.status === 'open'))
  assert.equal(t.ticket_replies.length, 0, 'crear casos no responde ni envía nada')
  const second = await st.syncProTickets(admin, ORG)
  assert.equal(second.created, 0)
  assert.equal(t.tickets.length, 2, 'sin duplicados')
})

test('Actualizar Pro reutiliza un ticket existente sobre Pro y no lo modifica', async () => {
  const existing = ticket('t-a', { title: 'No puedo pagar mi suscripción Pro', category: 'billing' })
  const { admin, t } = db({ influencers: [inf('a'), inf('b')], subscriptions: [attempt('a'), attempt('b')], tickets: [existing] })
  const r = await st.syncProTickets(admin, ORG)
  assert.equal(r.created, 1)
  assert.equal(r.existing, 1)
  assert.deepEqual(t.tickets.find(x => x.id === 't-a'), existing, 'el ticket previo queda intacto')
  const { ids } = await st.proFollowupTicketIds(admin, ORG)
  assert.ok(ids.includes('t-a'), 'el filtro incluye el ticket que ya existía')
  assert.equal(ids.length, 2)
})

test('un ticket cerrado no cuenta como cubierto: se crea uno nuevo', async () => {
  const { admin, t } = db({ influencers: [inf('a')], subscriptions: [attempt('a')], tickets: [ticket('t-a', { category: 'pro_followup', status: 'closed' })] }, { uniqueProOpen: true })
  assert.equal((await st.syncProTickets(admin, ORG)).created, 1)
  assert.equal(t.tickets.length, 2)
})

test('quien ya tiene Pro o está inactiva no entra', async () => {
  const { admin } = db({
    influencers: [inf('a', { is_active: false }), inf('b', { organization_id: 'otra' })],
    subscriptions: [attempt('a'), attempt('b')], tickets: [],
  })
  const r = await st.syncProTickets(admin, ORG, { dryRun: true })
  assert.equal(r.created, 0)
  assert.equal(r.total, 0)
})

// ── Responder: estados ─────────────────────────────────────────────────────
test('responder pasa Abierto → En progreso; En progreso y Cerrado no cambian', async () => {
  const { admin, t } = db({ tickets: [ticket('t-1'), ticket('t-2', { status: 'in_progress' }), ticket('t-3', { status: 'closed' })], ticket_replies: [] })
  for (const id of ['t-1', 't-2', 't-3']) await tr.saveAdminReply(admin, { ticketId: id, userId: 'admin', message: 'hola' })
  assert.deepEqual(t.tickets.map(x => x.status), ['in_progress', 'in_progress', 'closed'])
  assert.equal(t.ticket_replies.length, 3)
  assert.ok(t.ticket_replies.every(r => r.is_admin === true))
})

// ── Respuesta múltiple ─────────────────────────────────────────────────────
test('respuesta múltiple: personaliza, guarda historial y resultado del correo (sumidero)', async () => {
  const { admin, t } = db({
    influencers: [inf('a'), inf('b')],
    tickets: [ticket('t-a'), ticket('t-b'), ticket('t-c', { status: 'closed' })],
    ticket_replies: [],
  })
  const res = await tr.bulkReply(admin, { orgId: ORG, userId: 'admin', ticketIds: ['t-a', 't-b', 't-c', 't-a'], template: 'Hola {{nombre}}, revisa {{plan_url}}', now: NOW })
  assert.deepEqual(res.map(r => r.status), ['sent', 'sent', 'skipped'], 'duplicado en la selección se ignora; cerrado se omite')
  assert.match(t.ticket_replies[0].message, /^Hola Inf a, revisa https:\/\/.+\/inf-profile\?tab=plan$/)
  assert.ok(t.ticket_replies.every(r => r.email_status === 'sent'))
  assert.equal(t.tickets.find(x => x.id === 't-c')!.status, 'closed')
  assert.equal(t.tickets.find(x => x.id === 't-a')!.status, 'in_progress')
})

test('respuesta múltiple no repite el mismo mensaje al mismo ticket', async () => {
  const { admin, t } = db({ influencers: [inf('a')], tickets: [ticket('t-a')], ticket_replies: [] })
  const input = { orgId: ORG, userId: 'admin', ticketIds: ['t-a'], template: 'Gracias {{nombre}}', now: NOW }
  assert.equal((await tr.bulkReply(admin, input))[0].status, 'sent')
  const again = await tr.bulkReply(admin, input)
  assert.equal(again[0].status, 'skipped')
  assert.equal(t.ticket_replies.length, 1)
})

test('error de correo queda registrado en la respuesta (sin contacto)', async () => {
  const { admin, t } = db({ influencers: [], tickets: [ticket('t-x', { created_by: null })], ticket_replies: [] })
  const res = await tr.bulkReply(admin, { orgId: ORG, userId: 'admin', ticketIds: ['t-x'], template: 'Hola', now: NOW })
  assert.equal(res[0].status, 'failed')
  assert.equal(t.ticket_replies[0].email_status, 'failed')
  assert.ok(t.ticket_replies[0].email_error)
})

test('no toca tickets de otra organización', async () => {
  const { admin, t } = db({ influencers: [inf('a')], tickets: [ticket('t-a', { organization_id: 'otra' })], ticket_replies: [] })
  const res = await tr.bulkReply(admin, { orgId: ORG, userId: 'admin', ticketIds: ['t-a'], template: 'Hola', now: NOW })
  assert.equal(res[0].status, 'skipped')
  assert.equal(t.ticket_replies.length, 0)
})

// ── Guardias estáticas ─────────────────────────────────────────────────────
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('GET /api/tickets: Todos = activos; orden prioridad y luego más antiguo; cerrados más reciente primero', () => {
  const src = read('src/app/api/tickets/route.ts')
  assert.match(src, /query\.in\('status', \[\.\.\.ACTIVE_STATUSES\]\)/)
  assert.match(src, /order\('priority', \{ ascending: true \}\)\.order\('created_at', \{ ascending: true \}\)/)
  assert.match(src, /status === 'closed'\s*\?\s*query\.order\('created_at', \{ ascending: false \}\)/)
})
test('PATCH valida estado y prioridad (P0–P3)', () => {
  const src = read('src/app/api/tickets/[id]/route.ts')
  assert.match(src, /TICKET_PRIORITIES/)
  assert.deepEqual([...st.TICKET_PRIORITIES], ['P0', 'P1', 'P2', 'P3'])
  assert.deepEqual([...st.TICKET_STATUSES], ['open', 'in_progress', 'closed'])
})
test('las rutas nuevas exigen admin de plataforma y el envío múltiple exige confirm:true', () => {
  for (const f of ['templates', 'pro-followup', 'bulk-reply']) assert.match(read(`src/app/api/tickets/${f}/route.ts`), /requireSupportAdmin\(\)/)
  assert.match(read('src/lib/support-admin.ts'), /isPlatformAdmin/)
  assert.doesNotMatch(read('src/lib/support-admin.ts'), /profiles/)
  assert.match(read('src/app/api/tickets/bulk-reply/route.ts'), /body\.confirm !== true/)
})
test('nada dispara envíos solo: ni cron ni envío al crear casos', () => {
  assert.doesNotMatch(read('vercel.json'), /tickets|support|followup/i)
  assert.doesNotMatch(read('src/lib/support-tickets.ts'), /resend|notify/i)
})
test('el único camino de correo de una respuesta es deliverReplyEmail (barrera de influencer inactiva incluida)', () => {
  assert.match(read('src/lib/ticket-reply.ts'), /notifyContactOfSupportReply/)
  assert.match(read('src/lib/support-notifications.ts'), /getResend\(\)/)
})
test('migración: plantillas iniciales, columnas de resultado e índice único Pro', () => {
  const sql = read('supabase/migrations/20261110120000_support_reply_templates.sql')
  assert.match(sql, /Gracias por reportar este problema\. Estamos revisándolo/)
  assert.match(sql, /'pro_ayuda'/)
  assert.match(sql, /'paypal'/)
  assert.match(sql, /email_status/)
  assert.match(sql, /tickets_pro_followup_open_uidx/)
})
