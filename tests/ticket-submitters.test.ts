// Soporte: rol real del autor del ticket. Función pura + guardias estáticas
// contra el fallback «Admin» que confundía autores sin ficha con administradores.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSubmitterMap, type SubmitterSources } from '../src/lib/ticket-submitters.ts'

const base = (over: Partial<SubmitterSources>): SubmitterSources => ({
  userIds: [], platformAdminIds: new Set(), influencers: [], brands: [], brandMembers: [], accounts: {}, ...over,
})

describe('buildSubmitterMap', () => {
  test('influencer con ficha → Influencer, con enlace a su ficha', () => {
    const m = buildSubmitterMap(base({ userIds: ['u1'], influencers: [{ id: 'i1', user_id: 'u1', display_name: 'Ana', email: 'a@x.cl' }] }))
    assert.equal(m.u1.type, 'influencer')
    assert.equal(m.u1.profile_href, '/admin-influencers/i1')
  })

  test('marca (dueña o miembro) → Marca', () => {
    const m = buildSubmitterMap(base({
      userIds: ['u2', 'u3'],
      brands: [{ id: 'b1', user_id: 'u2', name: 'Marca', contact_name: null, contact_email: 'm@x.cl' }],
      brandMembers: [{ user_id: 'u3', brand_id: 'b1', email: 'mm@x.cl', name: null }],
    }))
    assert.equal(m.u2.type, 'brand')
    assert.equal(m.u3.type, 'brand')
  })

  test('super_admin activo → Admin', () => {
    const m = buildSubmitterMap(base({ userIds: ['u4'], platformAdminIds: new Set(['u4']), accounts: { u4: { name: 'Admin', email: 'adm@x.cl' } } }))
    assert.equal(m.u4.type, 'admin')
  })

  test('autor sin ficha ni permisos NO es Admin: «Usuario sin perfil» con el perfil existente', () => {
    const m = buildSubmitterMap(base({ userIds: ['u5'], accounts: { u5: { name: 'Camila', email: 'c@x.cl' } } }))
    assert.equal(m.u5.type, 'unknown')
    assert.equal(m.u5.name, 'Camila')
    assert.equal(m.u5.email, 'c@x.cl')
  })

  test('sin ningún dato → unknown, nunca admin', () => {
    const m = buildSubmitterMap(base({ userIds: ['u6'] }))
    assert.equal(m.u6.type, 'unknown')
    assert.equal(m.u6.name, 'Usuario sin perfil')
  })

  test('admin que además tiene ficha de influencer se muestra Admin; un influencer sin permisos jamás', () => {
    const m = buildSubmitterMap(base({
      userIds: ['u7', 'u8'], platformAdminIds: new Set(['u7']),
      influencers: [
        { id: 'i7', user_id: 'u7', display_name: 'X', email: null },
        { id: 'i8', user_id: 'u8', display_name: 'Y', email: null },
      ],
    }))
    assert.equal(m.u7.type, 'admin')
    assert.equal(m.u8.type, 'influencer')
  })
})

describe('guardias estáticas', () => {
  const route = readFileSync('src/app/api/tickets/route.ts', 'utf8')
  const ui = readFileSync('src/components/support/SupportPage.tsx', 'utf8')
  test("la ruta ya no asigna type: 'admin' como fallback", () => {
    assert.ok(!/type:\s*'admin'/.test(route))
    assert.match(route, /buildSubmitterMap/)
  })
  test("la interfaz no usa 'admin' como valor por defecto y define «Usuario sin perfil»", () => {
    assert.ok(!/type:\s*'admin'\s*as const/.test(ui))
    assert.match(ui, /unknown:\s*\{\s*label:\s*'Usuario sin perfil'/)
  })
  test('«Admin» se decide con ADMIN_ROLES (organization_members), no con profiles.role', () => {
    assert.match(route, /ADMIN_ROLES/)
    assert.ok(!/profiles'\)\.select\([^)]*role/.test(route))
  })
})
