// Errores de guardado que antes se ignoraban (CLAUDE.md §16.1: revisar `error` de cada escritura).
// Ejecuta los handlers REALES contra la base en memoria (tests/support/memory-supabase.ts, falla por tabla).
// LÍMITE: base simulada; no prueba RLS ni restricciones reales de PostgreSQL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>
const set = (user: string | null, db: Db, opts: Record<string, unknown> = {}) => {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db, opts) }
}
const json = (body: unknown) => ({ json: async () => body }) as any

const me = await import('../src/app/api/influencer/me/route.ts')
const merge = await import('../src/app/api/influencers/merge/route.ts')
const apps = await import('../src/app/api/admin/collaboration-applications/[id]/route.ts')

const adminMember = { id: 'm0', user_id: 'u-admin', organization_id: 'org-agency', role: 'super_admin', is_active: true, brand_id: null, is_owner: true }

function meDb(): Db {
  return {
    influencers: [{ id: 'inf-1', user_id: 'u1', user_name: 'Ana', email: 'a@x.cl', address: 'Calle 1', location_id: 'loc-1', phone: null, birth_date: null, metadata: {}, categories: [] }],
    influencer_social_profiles: [{ id: 'sp1', influencer_id: 'inf-1', platform: 'instagram', username: 'ana', followers: 10 }],
    locations: [], brands: [],
  }
}

test('/me PATCH: si falla guardar el @ nuevo de una red existente responde 500 (antes 200 con el dato sin guardar)', async () => {
  const db = meDb()
  set('u1', db, { failUpdateOn: 'influencer_social_profiles' })
  const res = await (me as any).PATCH(json({ social_profiles: [{ id: 'sp1', platform: 'instagram', username: 'ana_nueva' }] }))
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.ok(!/fallido/.test(JSON.stringify(body)), 'no muestra el error técnico de la base')
  assert.equal(db.influencer_social_profiles[0].username, 'ana')
})

test('/me PATCH: si falla crear una red nueva responde 500', async () => {
  set('u1', meDb(), { failInsertOn: 'influencer_social_profiles', autoId: true })
  const res = await (me as any).PATCH(json({ social_profiles: [{ platform: 'tiktok', username: 'ana_tt' }] }))
  assert.equal(res.status, 500)
})

test('/me PATCH: si falla borrar una red responde 500', async () => {
  set('u1', meDb(), { failDeleteOn: 'influencer_social_profiles' })
  const res = await (me as any).PATCH(json({ social_profiles: [{ id: 'sp1', platform: 'tiktok', _delete: true }, { platform: 'instagram', username: 'ana' }] }))
  assert.equal(res.status, 500)
})

test('/me PATCH: sin fallos sigue guardando el @ (comportamiento intacto)', async () => {
  const db = meDb()
  set('u1', db)
  const res = await (me as any).PATCH(json({ social_profiles: [{ id: 'sp1', platform: 'instagram', username: '@Ana_Nueva' }] }))
  assert.equal(res.status, 200)
  assert.equal(db.influencer_social_profiles[0].username, 'ana_nueva')
})

function mergeDb(): Db {
  return {
    organization_members: [adminMember],
    influencers: [
      { id: 'keep', organization_id: 'org-agency', email: null, phone: null, location_id: null, bio: null, categories: [], avatar_url: null, notes: null },
      { id: 'dup', organization_id: 'org-agency', email: 'dup@x.cl', phone: '+56911111111', location_id: null, bio: null, categories: [], avatar_url: null, notes: null },
    ],
    influencer_social_profiles: [{ id: 'sp-dup', influencer_id: 'dup', platform: 'tiktok', followers: 1 }],
    subscriptions: [], campaign_influencers: [], campaign_deliverables: [],
  }
}

test('merge: si falla copiar los datos del donante al registro principal NO borra al donante', async () => {
  const db = mergeDb()
  set('u-admin', db, { failUpdateOn: 'influencers' })
  const res = await (merge as any).POST(json({ keepId: 'keep', mergeIds: ['dup'] }))
  assert.equal(res.status, 500)
  assert.ok(db.influencers.some(r => r.id === 'dup'), 'el donante sigue existiendo (su email/teléfono no se perdieron)')
})

test('merge: si falla mover una red social NO borra al donante', async () => {
  const db = mergeDb()
  set('u-admin', db, { failUpdateOn: 'influencer_social_profiles' })
  const res = await (merge as any).POST(json({ keepId: 'keep', mergeIds: ['dup'] }))
  assert.equal(res.status, 500)
  assert.ok(db.influencers.some(r => r.id === 'dup'))
  assert.ok(db.influencer_social_profiles.some(r => r.id === 'sp-dup'))
})

function appsDb(): Db {
  return {
    organization_members: [adminMember],
    campaign_brand_applications: [{ id: 'app1', status: 'pending', campaign_id: 'c1', brand_id: 'b1', campaign: null, brand: null }],
  }
}

test('collaboration-applications: rechazar con la escritura fallida ya no responde success', async () => {
  const db = appsDb()
  set('u-admin', db, { failUpdateOn: 'campaign_brand_applications' })
  const res = await (apps as any).PATCH(json({ action: 'reject' }), { params: { id: 'app1' } })
  assert.equal(res.status, 500)
  assert.equal(db.campaign_brand_applications[0].status, 'pending')
})

test('collaboration-applications: rechazar sin fallos sigue respondiendo success', async () => {
  const db = appsDb()
  set('u-admin', db)
  const res = await (apps as any).PATCH(json({ action: 'reject' }), { params: { id: 'app1' } })
  assert.equal(res.status, 200)
  assert.equal(db.campaign_brand_applications[0].status, 'rejected')
})

// Rutas cuyo arranque exige muchas dependencias (reservas, correo): se comprueba por fuente que el error se capture.
const src = (p: string) => readFileSync(new URL(`../src/app/api/${p}`, import.meta.url), 'utf8')

test('bookings POST: el error del insert en booking_influencers se captura y se avisa (no pasa en silencio)', () => {
  const s = src('bookings/route.ts')
  assert.match(s, /const \{ error: biError \} = await admin\.from\('booking_influencers'\)\.insert/)
  assert.match(s, /if \(biError\)/)
})

test('attendance-confirmations: se revisan el error de la lectura previa y el de la plantilla', () => {
  const s = src('campaigns/[id]/attendance-confirmations/route.ts')
  assert.match(s, /const \{ data: existing, error: existingError \}/)
  assert.match(s, /if \(existingError\)/)
  assert.match(s, /const \{ error: templateError \} = await admin\.from\('campaigns'\)/)
  assert.match(s, /if \(templateError\)/)
})
