import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { brandSection, recordBrandActivity } from '../src/lib/brand-activity.ts'

const id = '12345678-0000-4000-8000-123456789abc'

test('las visitas se guardan como secciones conocidas, sin rutas ni parámetros', () => {
  assert.equal(brandSection('/brand-dash'), 'dashboard')
  assert.equal(brandSection('/brand-campaigns/new'), 'campaignNew')
  assert.equal(brandSection(`/brand-campaigns/${id}/edit`), 'campaignEdit')
  assert.equal(brandSection(`/brand-influencers/${id}`), 'influencer')
  assert.equal(brandSection('/brand-settings/users'), 'users')
  assert.equal(brandSection('/brand-campaigns/unknown'), null)
  assert.equal(brandSection(`/brand-campaigns/${id}?search=privado`), null)
  assert.equal(brandSection('/brand-settings/unknown'), null)
  assert.equal(brandSection('/admin-brands'), null)
})

test('la actividad se atribuye a la marca activa y al usuario autenticado', async () => {
  const inserts: unknown[] = []
  const db = {
    from(table: string) {
      assert.equal(table, 'audit_logs')
      return { insert: async (row: unknown) => { inserts.push(row); return { error: null } } }
    },
  } as unknown as Parameters<typeof recordBrandActivity>[0]
  await recordBrandActivity(db, {
    organizationId: 'org-agencia', brandId: id, role: 'member', isOwner: false, status: 'approved',
  }, 'usuario-autenticado', 'campaignSubmitted', 'Campaña de verano')
  assert.deepEqual(inserts, [{
    actor_id: 'usuario-autenticado',
    organization_id: 'org-agencia',
    entity_id: id,
    entity_type: 'brand',
    action: 'brand_portal.campaignSubmitted',
    changes: { campaign_name: 'Campaña de verano' },
  }])
})

test('la lectura usa el guard de superadmin y el ID exacto de la ficha', () => {
  const route = readFileSync(new URL('../src/app/api/brands/[id]/route.ts', import.meta.url), 'utf8')
  const history = route.indexOf("searchParams.get('view') === 'history'")
  assert.ok(history > -1)
  assert.match(route.slice(0, history), /if \(!await isPlatformAdmin\(user.id, admin\)\)/)
  assert.match(route.slice(history), /\.eq\('entity_id', params.id\)/)
  assert.match(route.slice(history), /'Cache-Control': 'private, no-store'/)
})
