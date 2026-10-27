import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  validateSelfCampaignCreate,
  buildSelfCampaignUpdate,
  SELF_CAMPAIGN_ALLOWED_STATUSES,
  SELF_CAMPAIGN_NAME_MAX,
} from '../src/lib/influencer-self-campaign.ts'

const route = readFileSync(new URL('../src/app/api/influencer/my-campaigns/route.ts', import.meta.url), 'utf8')

// ── brand_id ────────────────────────────────────────────────────────────────

test('POST: brand_id del body no llega al valor validado', () => {
  const r = validateSelfCampaignCreate({ name: 'Mi campaña', brand_id: 'marca-ajena' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal('brand_id' in r.value, false)
})

test('PATCH: brand_id del body no llega al UPDATE', () => {
  const r = buildSelfCampaignUpdate({ name: 'Nuevo', brand_id: 'marca-ajena' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal('brand_id' in r.value, false)
    assert.deepEqual(r.value, { name: 'Nuevo' })
  }
})

test('ruta: el INSERT fija brand_id en null y el PATCH no lo lee del body', () => {
  assert.match(route, /brand_id: null,/)
  assert.doesNotMatch(route, /brand_id\s*:\s*brand_id/)
  assert.doesNotMatch(route, /const\s*\{[^}]*\bbrand_id\b[^}]*\}\s*=\s*body/)
  assert.doesNotMatch(route, /allowed\s*=\s*\[[^\]]*brand_id/)
})

test('ruta: ningún select de campañas propias devuelve contact_email/contact_name de la marca', () => {
  const start = route.indexOf('// Campaigns created by the influencer themselves')
  const end = route.indexOf('// Preasignación en draft')
  assert.ok(start > 0 && end > start, 'no se encontró el bloque self-created del GET')
  assert.doesNotMatch(route.slice(start, end), /contact_(email|name)/)
  const fromPost = route.slice(route.indexOf('export async function POST'))
  assert.doesNotMatch(fromPost, /contact_(email|name)/)
})

// ── estados ─────────────────────────────────────────────────────────────────

test('PATCH: la influencer solo puede pausar, completar o cancelar', () => {
  assert.deepEqual([...SELF_CAMPAIGN_ALLOWED_STATUSES].sort(), ['canceled', 'completed', 'paused'])
  for (const status of SELF_CAMPAIGN_ALLOWED_STATUSES) {
    const r = buildSelfCampaignUpdate({ status })
    assert.equal(r.ok, true, status)
  }
})

test('PATCH: rechaza activar, borrador, revisión y valores inválidos', () => {
  for (const status of ['active', 'draft', 'pending_approval', 'inactive', 'ACTIVE', '', null, 1, {}]) {
    const r = buildSelfCampaignUpdate({ status })
    assert.equal(r.ok, false, String(status))
  }
})

test('POST: el body no puede fijar status (la ruta lo deja en active como hasta ahora)', () => {
  const r = validateSelfCampaignCreate({ name: 'X', status: 'completed' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal('status' in r.value, false)
  assert.match(route, /status: 'active',\s*\n\s*type: 'sponsored_post'/)
})

test('ruta: nunca escribe campaign_influencers.status (CLAUDE.md 16.1)', () => {
  const link = route.slice(route.indexOf("from('campaign_influencers').insert"))
  const block = link.slice(0, link.indexOf('})'))
  assert.doesNotMatch(block, /\bstatus\s*:/)
  assert.match(block, /application_status: 'accepted'/)
})

// ── validaciones ────────────────────────────────────────────────────────────

test('POST: nombre obligatorio, recortado y con largo máximo', () => {
  assert.equal(validateSelfCampaignCreate({}).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: '   ' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 123 }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'a'.repeat(SELF_CAMPAIGN_NAME_MAX + 1) }).ok, false)
  assert.equal(validateSelfCampaignCreate(null).ok, false)
  const r = validateSelfCampaignCreate({ name: '  Verano  ' })
  assert.equal(r.ok && r.value.name, 'Verano')
})

test('POST: valores por defecto y formato de la UI actual (fechas vacías → null)', () => {
  const r = validateSelfCampaignCreate({ name: 'X', start_date: null, end_date: null, description: null })
  assert.deepEqual(r.ok && r.value, {
    name: 'X', description: null, start_date: null, end_date: null, currency: 'CLP', fee: null,
  })
})

test('POST: fechas reales y en orden', () => {
  assert.equal(validateSelfCampaignCreate({ name: 'X', start_date: '2026-13-40' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', start_date: '19/10/2026' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', start_date: '2026-10-20', end_date: '2026-10-19' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', start_date: '2026-10-19', end_date: '2026-10-19' }).ok, true)
})

test('POST: moneda y fee', () => {
  assert.equal(validateSelfCampaignCreate({ name: 'X', currency: 'usd' }).ok, true)
  assert.equal(validateSelfCampaignCreate({ name: 'X', currency: 'DROP TABLE' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', fee: -1 }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', fee: '100' }).ok, false)
  assert.equal(validateSelfCampaignCreate({ name: 'X', fee: 0 }).ok, true)
})

test('PATCH: valida el orden de fechas contra los valores guardados', () => {
  const existing = { start_date: '2026-10-10', end_date: '2026-10-20' }
  assert.equal(buildSelfCampaignUpdate({ end_date: '2026-10-05' }, existing).ok, false)
  assert.equal(buildSelfCampaignUpdate({ start_date: '2026-10-25' }, existing).ok, false)
  assert.equal(buildSelfCampaignUpdate({ end_date: '2026-10-30' }, existing).ok, true)
})

test('PATCH: solo entregables → UPDATE vacío (flujo actual de la UI sigue igual)', () => {
  const r = buildSelfCampaignUpdate({})
  assert.deepEqual(r.ok && r.value, {})
})

// ── ownership y errores de escritura ────────────────────────────────────────

test('ruta: PATCH y DELETE exigen created_by === user.id y el UPDATE repite el filtro', () => {
  assert.equal((route.match(/existing\.created_by !== user\.id/g) ?? []).length, 2)
  assert.match(route, /\.update\(updatePayload\)\.eq\('id', id\)\.eq\('created_by', user\.id\)/)
  assert.match(route, /\.update\(\{ status: 'canceled' \}\)\.eq\('id', id\)\.eq\('created_by', user\.id\)/)
})

test('ruta: toda escritura de PATCH/DELETE revisa error', () => {
  const patch = route.slice(route.indexOf('export async function PATCH'))
  const writes = patch.match(/await admin\.from\('campaign(s|_deliverables)'\)\.(update|insert|delete)/g) ?? []
  assert.ok(writes.length >= 5, `esperaba ≥5 escrituras, hay ${writes.length}`)
  // ninguna escritura queda sin asignar su resultado
  assert.doesNotMatch(patch, /^\s*await admin\.from\('campaign(s|_deliverables)'\)\.(update|insert|delete)/m)
  for (const name of ['updErr', 'insErr', 'delErr', 'dUpdErr', 'cancelErr']) {
    assert.match(patch, new RegExp(`if \\(${name}\\)`), name)
  }
})

test('ruta: si falla el vínculo se deshace la campaña y se responde 500', () => {
  assert.match(route, /if \(linkErr\)/)
  assert.match(route, /\.delete\(\)\.eq\('id', newCampaign\.id\)\.eq\('created_by', user\.id\)/)
})
