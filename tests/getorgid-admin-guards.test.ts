// Rutas que solo existen en pantallas /admin-* (afiliados, eventos, importación masiva, duplicados, IA de campañas):
// ejecutan los handlers REALES contra una base en memoria (sin red ni producción). Un miembro de marca
// (cualquier rol) recibe 403 sin tocar datos; super_admin sigue pasando; sin sesión 401.
// LÍMITES: no prueba RLS real; los handlers que escriben se prueban solo hasta la guarda.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null) => ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner: false, is_active: true })
const freshDb = (): Record<string, Row[]> => ({
  organization_members: [
    m('uOwner', 'org-A', 'brand_manager', 'brand-A'), m('uMember', 'org-A', 'member', 'brand-A'),
    m('uFin', 'org-A', 'finance', 'brand-A'), m('uAdmin', 'org-adm', 'super_admin', null),
  ],
  affiliate_links: [], events: [], commission_settlements: [], influencers: [], campaigns: [],
})
const req = (url = 'http://localhost/api/x', body: unknown = {}) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any

const CASES: Array<{ file: string; calls: Array<[string, any[]]> }> = [
  { file: 'affiliates/route.ts', calls: [['GET', [req()]], ['POST', [req()]]] },
  { file: 'affiliates/[id]/route.ts', calls: [['GET', [req(), { params: { id: 'x' } }]], ['PATCH', [req(), { params: { id: 'x' } }]], ['DELETE', [req(), { params: { id: 'x' } }]]] },
  { file: 'affiliates/[id]/conversions/route.ts', calls: [['GET', [req(), { params: { id: 'x' } }]], ['POST', [req(), { params: { id: 'x' } }]]] },
  { file: 'affiliates/settlements/route.ts', calls: [['GET', []], ['POST', [req()]]] },
  { file: 'affiliates/settlements/[id]/route.ts', calls: [['PATCH', [req(), { params: { id: 'x' } }]]] },
  { file: 'events/route.ts', calls: [['GET', [req()]], ['POST', [req()]]] },
  { file: 'events/[id]/route.ts', calls: [['GET', [req(), { params: { id: 'x' } }]], ['PATCH', [req(), { params: { id: 'x' } }]], ['DELETE', [req(), { params: { id: 'x' } }]]] },
  { file: 'events/[id]/tickets/route.ts', calls: [['GET', [req(), { params: { id: 'x' } }]], ['POST', [req(), { params: { id: 'x' } }]]] },
  { file: 'events/[id]/sales/route.ts', calls: [['GET', [req(), { params: { id: 'x' } }]], ['POST', [req(), { params: { id: 'x' } }]]] },
  { file: 'influencers/bulk/route.ts', calls: [['POST', [req('http://localhost/api/influencers/bulk', { rows: [] })]]] },
  { file: 'influencers/duplicates/route.ts', calls: [['GET', [req()]]] },
  { file: 'campaigns/ai-build/route.ts', calls: [['POST', [req('http://localhost/api/campaigns/ai-build', { prompt: 'x' })]]] },
]

for (const c of CASES) {
  test(`${c.file}: miembros de marca 403, sin sesión 401, super_admin pasa la guarda`, async () => {
    const route = await import(`../src/app/api/${c.file}`)
    for (const [method, args] of c.calls) {
      for (const user of ['uOwner', 'uMember', 'uFin']) {
        ;(globalThis as any).__routeHarness = { user: { id: user }, admin: makeAdmin(freshDb(), { projectColumns: true }) }
        const res = await route[method](...args)
        assert.equal(res.status, 403, `${c.file} ${method} ${user}`)
      }
      ;(globalThis as any).__routeHarness = { user: null, admin: makeAdmin(freshDb(), { projectColumns: true }) }
      assert.equal((await route[method](...args)).status, 401, `${c.file} ${method} sin sesión`)
      ;(globalThis as any).__routeHarness = { user: { id: 'uAdmin' }, admin: makeAdmin(freshDb(), { projectColumns: true }) }
      let status = 0
      try { status = (await route[method](...args)).status } catch { status = -1 } // falla posterior a la guarda (datos vacíos) ≠ 403
      assert.notEqual(status, 403, `${c.file} ${method} super_admin no debe recibir 403`)
    }
  })
}

test('estático: ningún handler de estos archivos llama getOrgId antes de la guarda isPlatformAdmin', () => {
  for (const c of CASES) {
    const src = readFileSync(new URL(`../src/app/api/${c.file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
    const calls = [...src.matchAll(/await getOrgId\(/g)].length
    const guards = [...src.matchAll(/await isPlatformAdmin\(/g)].length
    assert.ok(guards >= calls && calls > 0, `${c.file}: guardas=${guards} getOrgId=${calls}`)
    for (const mm of src.matchAll(/await getOrgId\(/g)) {
      const before = src.slice(0, mm.index)
      assert.ok(before.lastIndexOf('isPlatformAdmin(') > before.lastIndexOf('getOrgId(') , `${c.file}: getOrgId sin guarda previa`)
    }
  }
})

test('ai-build: la guarda va ANTES de llamar a Claude (no gasta créditos para quien no es admin)', () => {
  const src = readFileSync(new URL('../src/app/api/campaigns/ai-build/route.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  const post = src.slice(src.indexOf('export async function POST'))
  assert.ok(post.indexOf('isPlatformAdmin(') < post.indexOf('callClaude('))
})
