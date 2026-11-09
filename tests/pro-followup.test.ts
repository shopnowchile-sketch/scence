// Seguimiento Pro manual (2026-11-09). Sin red ni correos reales: base en memoria + sumidero de Resend.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const pf = await import('../src/lib/pro-followup.ts')
const optouts = await import('../src/lib/email-optouts.ts')
const { createBlockedResend } = await import('../src/lib/resend-blocked.ts')

process.env.INTERNAL_JOB_SECRET = 'test-secret'
const ORG = 'org-1'
const NOW = new Date('2026-11-09T15:00:00Z')
type Row = Record<string, any>

function db(seed: Record<string, Row[]>, opts: { failTable?: string; dupOnInsert?: boolean } = {}) {
  const t: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  const get = (row: Row, col: string) => col.includes('->>') ? (row[col.split('->>')[0]] ?? {})[col.split('->>')[1]] : row[col]
  const admin: any = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let mode: 'select' | 'insert' = 'select'
      let payload: Row | null = null
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filters.push(r => get(r, c) === v); return q },
        in: (c: string, vs: any[]) => { filters.push(r => vs.includes(get(r, c))); return q },
        order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: (t[table] ?? []).find(r => filters.every(f => f(r))) ?? null, error: null }),
        insert: (row: Row) => { mode = 'insert'; payload = row; return q },
        then: (resolve: any) => {
          if (opts.failTable === table) return resolve({ data: null, error: { message: 'boom' } })
          if (mode === 'insert') {
            if (opts.dupOnInsert) return resolve({ data: null, error: { code: '23505', message: 'dup' } })
            ;(t[table] ??= []).push({ created_at: NOW.toISOString(), ...payload! })
            return resolve({ data: null, error: null })
          }
          return resolve({ data: (t[table] ?? []).filter(r => filters.every(f => f(r))), error: null })
        },
      }
      return q
    },
  }
  return { admin, t }
}

const inf = (id: string, extra: Row = {}) => ({ id, display_name: `Inf ${id}`, email: `${id}@example.test`, organization_id: ORG, is_active: true, metadata: {}, ...extra })
const attempt = (id: string, extra: Row = {}) => ({ status: 'incomplete', organization_id: ORG, metadata: { influencer_id: id }, paypal_payer_id: null, created_at: '2026-11-05T10:00:00Z', current_period_end: null, ...extra })
const cand = (extra: Partial<import('../src/lib/pro-followup.ts').Candidate> = {}): import('../src/lib/pro-followup.ts').Candidate => ({
  id: 'a', display_name: 'Ana', email: 'a@example.test', organization_id: ORG, is_active: true, pro: 'free', attempts: 1,
  lastAttemptAt: null, unverifiedCharge: false, optedOut: false, lastSent: null, sentRecently: false, ...extra,
})

// ── Reglas: asistencia vs comercial ────────────────────────────────────────
test('asistencia: requiere intento Pro; no depende de bajas', () => {
  assert.equal(pf.evaluateCandidate(cand(), 'assistance', ORG).eligible, true)
  assert.equal(pf.evaluateCandidate(cand({ attempts: 0 }), 'assistance', ORG).eligible, false)
  assert.equal(pf.evaluateCandidate(cand({ optedOut: true }), 'assistance', ORG).eligible, true, 'una baja comercial no bloquea asistencia')
})
test('comercial: la baja bloquea', () => {
  const v = pf.evaluateCandidate(cand({ optedOut: true }), 'commercial', ORG)
  assert.equal(v.eligible, false)
  assert.match(v.reason!, /baja/i)
})
test('cobro sin verificar: solo asistencia', () => {
  assert.equal(pf.evaluateCandidate(cand({ unverifiedCharge: true }), 'commercial', ORG).eligible, false)
  assert.equal(pf.evaluateCandidate(cand({ unverifiedCharge: true }), 'assistance', ORG).eligible, true)
})
test('Pro activo, inactiva, sin correo u otra organización: nunca', () => {
  for (const kind of ['assistance', 'commercial'] as const) {
    assert.equal(pf.evaluateCandidate(cand({ pro: 'paid' }), kind, ORG).eligible, false)
    assert.equal(pf.evaluateCandidate(cand({ pro: 'manual' }), kind, ORG).eligible, false)
    assert.equal(pf.evaluateCandidate(cand({ is_active: false }), kind, ORG).eligible, false)
    assert.equal(pf.evaluateCandidate(cand({ email: null }), kind, ORG).eligible, false)
    assert.equal(pf.evaluateCandidate(cand({ organization_id: 'otra' }), kind, ORG).eligible, false)
  }
})
test('duplicado accidental: misma plantilla reciente se bloquea', () => {
  assert.equal(pf.evaluateCandidate(cand({ sentRecently: true }), 'assistance', ORG).eligible, false)
})

// ── Personalización y vista previa ─────────────────────────────────────────
test('personaliza nombre y enlace; la vista previa muestra remitente, destinatario, asunto, cuerpo y enlaces', () => {
  const [item] = pf.buildPreview([cand()], 'commercial', ORG, 'Hola {{nombre}}', 'Entra: {{plan_url}}', 'SCENCE <x@scence.test>')
  assert.equal(item.subject, 'Hola Ana')
  assert.equal(item.to, 'a@example.test')
  assert.equal(item.from, 'SCENCE <x@scence.test>')
  assert.ok(item.body.includes('/inf-profile?tab=plan'))
  assert.ok(item.links.some(l => l.includes('/inf-profile?tab=plan')))
  assert.ok(item.unsubscribe_url && item.links.includes(item.unsubscribe_url), 'comercial lleva link de baja')
})
test('asistencia no lleva link de baja', () => {
  const [item] = pf.buildPreview([cand()], 'assistance', ORG, 's', 'b', 'f')
  assert.equal(item.unsubscribe_url, null)
})
test('el HTML escapa el contenido', () => {
  assert.ok(!pf.buildHtml('<b>x</b>', '<script>1</script>', null).includes('<script>'))
})

// ── Bajas: token de influencer ─────────────────────────────────────────────
test('token de baja de influencer: válido, y no se cruza con tokens de lead', () => {
  const t = optouts.signInfluencerUnsubscribeToken('inf-1')!
  assert.equal(optouts.verifyInfluencerUnsubscribeToken('inf-1', t), true)
  assert.equal(optouts.verifyInfluencerUnsubscribeToken('inf-2', t), false)
  assert.equal(optouts.verifyUnsubscribeToken('inf-1', t), false)
  assert.equal(optouts.verifyInfluencerUnsubscribeToken('inf-1', optouts.signUnsubscribeToken('inf-1')), false)
})

// ── Carga de candidatos y envío (sumidero) ─────────────────────────────────
test('loadCandidates: estados Pro, intentos, cobro sin verificar y bajas', async () => {
  const { admin } = db({
    influencers: [inf('a'), inf('b'), inf('c', { metadata: { manual_pro: { active: true } } })],
    subscriptions: [attempt('a'), attempt('b', { paypal_payer_id: 'PAYER' })],
    email_optouts: [{ email: 'a@example.test' }],
    influencer_email_log: [],
  })
  const c = await pf.loadCandidates(admin, ORG, ['a', 'b', 'c'], 'recovery_pro', 'commercial', NOW)
  const by = Object.fromEntries(c.map(x => [x.id, x]))
  assert.equal(by.a.optedOut, true)
  assert.equal(by.b.unverifiedCharge, true)
  assert.equal(by.c.pro, 'manual')
})

test('envío: solo elegibles, registra historial, usa el sumidero (sin red) y no duplica', async () => {
  const { admin, t } = db({
    influencers: [inf('a'), inf('b'), inf('c')],
    subscriptions: [attempt('a'), attempt('b', { paypal_payer_id: 'PAYER' }), attempt('c')],
    email_optouts: [{ email: 'c@example.test' }],
    influencer_email_log: [],
  })
  const logs: string[] = []
  const resend = createBlockedResend(m => logs.push(m)) as any
  const input = { orgId: ORG, userId: 'admin-1', ids: ['a', 'b', 'c'], kind: 'commercial' as const, templateKey: 'recovery_pro', subject: 'S', body: 'B {{plan_url}}', now: NOW }
  const res = await pf.sendFollowup(admin, resend, 'SCENCE <x@scence.test>', input)
  const by = Object.fromEntries(res.map(r => [r.influencer_id, r]))
  assert.equal(by.a.status, 'sent')
  assert.match(by.a.resend_id!, /^blocked-non-production-/)
  assert.equal(by.b.status, 'skipped', 'cobro sin verificar no recibe comercial')
  assert.equal(by.c.status, 'skipped', 'dada de baja no recibe comercial')
  assert.equal(logs.length, 1, 'un solo envío al sumidero')
  assert.equal(t.influencer_email_log.length, 1)
  assert.equal(t.influencer_email_log[0].sent_by, 'admin-1')
  assert.ok(t.influencer_email_log[0].dedupe_key.startsWith('a:recovery_pro:'))
  // segundo intento: duplicado accidental
  const again = await pf.sendFollowup(admin, resend, 'f', input)
  assert.equal(again.find(r => r.influencer_id === 'a')!.status, 'skipped')
  assert.equal(logs.length, 1)
})

test('asistencia llega a quien se dio de baja y a cobros sin verificar', async () => {
  const { admin } = db({
    influencers: [inf('a'), inf('b')],
    subscriptions: [attempt('a'), attempt('b', { paypal_payer_id: 'P' })],
    email_optouts: [{ email: 'a@example.test' }, { email: 'b@example.test' }],
    influencer_email_log: [],
  })
  const res = await pf.sendFollowup(admin, createBlockedResend(() => {}) as any, 'f', { orgId: ORG, userId: 'u', ids: ['a', 'b'], kind: 'assistance', templateKey: 'assistance_paypal', subject: 'S', body: 'B', now: NOW })
  assert.deepEqual(res.map(r => r.status), ['sent', 'sent'])
})

test('error de Resend: queda "failed" en el historial y no cuenta como enviado', async () => {
  const { admin, t } = db({ influencers: [inf('a')], subscriptions: [attempt('a')], influencer_email_log: [] })
  const resend = { emails: { send: async () => ({ data: null, error: { message: 'rate limited' } }) } }
  const res = await pf.sendFollowup(admin, resend, 'f', { orgId: ORG, userId: 'u', ids: ['a'], kind: 'assistance', templateKey: 'assistance_paypal', subject: 'S', body: 'B', now: NOW })
  assert.equal(res[0].status, 'failed')
  assert.equal(t.influencer_email_log[0].status, 'failed')
  assert.equal(t.influencer_email_log[0].dedupe_key, null, 'un fallo no bloquea el reintento')
})

test('falla cerrado: si no se puede leer la lista de bajas no se envía nada comercial', async () => {
  const { admin } = db({ influencers: [inf('a')], subscriptions: [attempt('a')], influencer_email_log: [] }, { failTable: 'email_optouts' })
  let sent = 0
  const resend = { emails: { send: async () => { sent++; return { data: { id: 'x' }, error: null } } } }
  await assert.rejects(pf.sendFollowup(admin, resend, 'f', { orgId: ORG, userId: 'u', ids: ['a'], kind: 'commercial', templateKey: 'recovery_pro', subject: 'S', body: 'B', now: NOW }))
  assert.equal(sent, 0)
})

// ── Guardias estáticas: permisos y "nunca automático" ──────────────────────
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('rutas exigen admin de plataforma y el envío exige confirm:true', () => {
  for (const f of ['src/app/api/influencers/pro-attempt-followup/route.ts', 'src/app/api/influencers/pro-followup-templates/route.ts']) {
    assert.match(read(f), /requireAdmin\(\)/)
  }
  assert.match(read('src/app/api/influencers/pro-attempt-followup/route.ts'), /body\.confirm !== true/)
  assert.match(read('src/lib/pro-followup-admin.ts'), /isAdmin/)
  assert.doesNotMatch(read('src/lib/pro-followup-admin.ts'), /profiles/)
})
test('ningún cron ni job dispara el seguimiento Pro', () => {
  const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  assert.doesNotMatch(vercel, /followup/i)
})
test('solo la plantilla comercial consulta bajas y el panel muestra la confirmación', () => {
  assert.match(read('src/lib/pro-followup.ts'), /kind === 'commercial' \? await getBlockedEmails/)
  assert.match(read('src/components/influencers/ProFollowupPanel.tsx'), /followup-confirm/)
})
