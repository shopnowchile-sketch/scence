// Auditoría 2026-10-22 de endpoints /api/influencer/*: propiedad del recurso, escape de HTML en el correo de
// entregas y datos de otras influencers en el marketplace. Base en memoria; el envío de correo se captura
// interceptando fetch (no sale nada a Internet). LÍMITE: no prueba Resend real, PayPal ni Storage.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const fresh = (): Record<string, Row[]> => ({
  influencers: [
    { id: 'inf-1', user_id: 'u1', display_name: '<img src=x onerror=alert(1)>Ana', organization_id: 'org-x', is_active: true },
    { id: 'inf-2', user_id: 'u2', display_name: 'Bea', organization_id: 'org-x', is_active: true },
  ],
  campaigns: [
    { id: 'camp-1', name: 'Camp <b>1</b>', status: 'active', visibility: 'open', organization_id: 'org-x', created_by: null, metadata: {}, start_date: null, end_date: null,
      campaign_influencers: [{ id: 'ci-otra', application_status: 'accepted', influencer_id: 'inf-2' }] },
  ],
  campaign_influencers: [
    { id: 'ci-1', campaign_id: 'camp-1', influencer_id: 'inf-1', application_status: 'accepted' },
    { id: 'ci-2', campaign_id: 'camp-1', influencer_id: 'inf-2', application_status: 'accepted' },
  ],
  campaign_deliverables: [
    { id: 'd-1', campaign_id: 'camp-1', influencer_id: 'inf-1', status: 'pending', type: 'reel', title: '<script>x</script>Reel', content_url: null,
      campaign: { name: 'Camp <b>1</b>', organization_id: 'org-x', status: 'active' } },
    { id: 'd-2', campaign_id: 'camp-1', influencer_id: 'inf-2', status: 'pending', type: 'reel', title: 'ajeno', content_url: null,
      campaign: { name: 'Camp', organization_id: 'org-x', status: 'active' } },
  ],
  bookings: [], subscriptions: [], subscription_payments: [], campaign_assets: [], campaign_covers: [],
})
const as = (user: string | null, db = fresh()) => { ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db, { projectColumns: true }) }; return db }
const mk = (body: unknown = {}) => ({ url: 'http://x', json: async () => body, headers: new Headers(), nextUrl: new URL('http://x') }) as any

const sent: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (url.includes('resend.com')) { sent.push(String(init?.body ?? '')); return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  return realFetch(input, init)
}) as typeof fetch

const htmlOf = () => sent.map(b => { try { return String(JSON.parse(b).html ?? '') } catch { return b } }).join('\n')
const submit = await import('../src/app/api/influencer/deliverables/[id]/submit/route.ts')
const open = await import('../src/app/api/influencer/campaigns/open/route.ts')
const POST = (id: string, body: unknown) => (submit as any).POST(mk(body), { params: { id } })

test('submit: sin sesión 401; deliverable de otra influencer 403; usuario sin ficha 404', async () => {
  as(null); assert.equal((await POST('d-1', {})).status, 401)
  as('u1'); assert.equal((await POST('d-2', {})).status, 403)
  as('u-nadie'); assert.equal((await POST('d-1', {})).status, 404)
})
test('submit: influencer no aceptada en la campaña → 403 (no puede entregar)', async () => {
  const db = fresh(); db.campaign_influencers[0].application_status = 'pending'
  as('u1', db); assert.equal((await POST('d-1', {})).status, 403)
})
test('submit: el correo a operaciones escapa nombre, título, campaña y URL; un esquema javascript: no es enlace', async () => {
  sent.length = 0
  const db = as('u1')
  const r = await POST('d-1', { content_url: 'javascript:alert(1)"><script>evil()</script>' })
  assert.equal(r.status, 200)
  assert.equal(db.campaign_deliverables.find(d => d.id === 'd-1')!.status, 'in_review')
  const html = htmlOf()
  assert.ok(html.length > 0, 'se envió correo')
  assert.ok(!/<img src=x/i.test(html) && !/<script>/i.test(html) && !/<b>1<\/b>/.test(html), 'sin HTML inyectado')
  assert.ok(!/href="javascript:/i.test(html), 'sin enlace javascript:')
  assert.ok(html.includes('&lt;img src=x'), 'el nombre aparece escapado')
})
test('submit: una URL https sí se enlaza (escapada)', async () => {
  sent.length = 0; as('u1')
  assert.equal((await POST('d-1', { content_url: 'https://instagram.com/p/abc?x=1&y="2"' })).status, 200)
  const html = htmlOf()
  assert.ok(/href="https:\/\/instagram\.com\/p\/abc\?x=1&amp;y=&quot;2&quot;/.test(html), html.slice(0, 400))
})
test('campaigns/open: no devuelve las filas campaign_influencers de otras influencers (solo accepted_count)', async () => {
  const db = fresh(); db.campaign_influencers = []   // u1 aún no participa → la campaña le aparece
  as('u1', db)
  const r = await (open as any).GET(); assert.equal(r.status, 200)
  const body = await r.json()
  assert.ok(body.data.length >= 1)
  for (const c of body.data) { assert.equal('campaign_influencers' in c, false); assert.equal(typeof c.accepted_count, 'number') }
  assert.ok(!JSON.stringify(body).includes('ci-otra'))
})
