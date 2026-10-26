// Reenviar/re-invitar NUNCA reduce permisos: organization_members es la fuente de verdad del rol (CLAUDE.md 16.2).
// Caso real: Catalina (VIP Class) era brand_manager en organization_members pero 'member' en brand_members;
// reenviar la habría bajado a 'member' (sin campaign.manage). Base en memoria, sin red ni producción.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeAdmin } from './support/memory-supabase.ts'
import { ensureBrandMembership, brandMemberRoleFor, officialRoleFor } from '../src/lib/brand-membership.ts'
import { normalizeBrandRole, roleHasBrandPermission } from '../src/lib/brand-permissions.ts'

type Row = Record<string, any>
const om = (user_id: string, role: string, extra: Row = {}): Row =>
  ({ id: `om-${user_id}`, organization_id: 'org-A', brand_id: 'brand-A', user_id, role, is_owner: false, is_active: true, ...extra })
const run = (rows: Row[], userId: string, requestedRole: string, brandId: string | null = 'brand-A') => {
  const db = { organization_members: rows }
  return ensureBrandMembership(makeAdmin(db), { organizationId: 'org-A', brandId, userId, requestedRole }).then(r => ({ r, rows: db.organization_members }))
}

test('caso Catalina: brand_manager existente + reenvío como "member" conserva el acceso operativo', async () => {
  const { r, rows } = await run([om('cata', 'brand_manager')], 'cata', 'member')
  assert.deepEqual([r.role, r.preserved, r.created], ['brand_manager', true, false])
  assert.equal(rows.length, 1, 'sin filas duplicadas')
  assert.equal(rows[0].role, 'brand_manager')
  assert.equal(brandMemberRoleFor(r.role, r.is_owner), 'member', 'brand_members se alinea: solo owner o member')
})

test('owner activo conserva rol e is_owner (antes el upsert lo dejaba is_owner=false)', async () => {
  const { r, rows } = await run([om('own', 'brand_manager', { is_owner: true })], 'own', 'finance')
  assert.deepEqual([r.role, r.is_owner], ['brand_manager', true])
  assert.equal(rows[0].is_owner, true)
  assert.equal(brandMemberRoleFor(r.role, r.is_owner), 'owner')
})

test('un miembro existente no cambia de rol al re-invitar', async () => {
  const { r, rows } = await run([om('mem', 'member')], 'mem', 'brand_manager')
  assert.equal(r.role, 'member'); assert.equal(rows[0].role, 'member')
})

test('usuario nuevo (p. ej. influencer sin membresía de marca): se crea con el rol pedido, sin owner', async () => {
  const { r, rows } = await run([om('otro', 'member')], 'infl', 'brand_manager')
  assert.deepEqual([r.role, r.created, r.is_owner], ['brand_manager', true, false], 'todo no-owner se guarda como brand_manager (igual que el trigger)')
  assert.equal(rows.length, 2)
  assert.equal(rows.find(x => x.user_id === 'otro')!.role, 'member', 'no toca a otros usuarios')
})

test('acceso revocado (is_active=false) y re-invitado: nuevo otorgamiento con el rol pedido, nunca owner', async () => {
  const { r, rows } = await run([om('rev', 'brand_manager', { is_owner: true, is_active: false })], 'rev', 'member')
  assert.deepEqual([r.role, r.is_owner, r.preserved], ['brand_manager', false, false])
  assert.deepEqual([rows[0].is_active, rows[0].role, rows[0].is_owner], [true, 'brand_manager', false])
})

test('fila activa sin brand_id: se completa brand_id y se conserva el rol', async () => {
  const { rows } = await run([om('sinb', 'member', { brand_id: null })], 'sinb', 'member')
  assert.deepEqual([rows[0].brand_id, rows[0].role], ['brand-A', 'member'])
})

test('falla cerrado: error de lectura/escritura se lanza, no se ignora', async () => {
  const db = { organization_members: [om('x', 'member', { is_active: false })] }
  await assert.rejects(() => ensureBrandMembership(makeAdmin(db, { failSelectOn: 'organization_members' }), { organizationId: 'org-A', brandId: 'brand-A', userId: 'x', requestedRole: 'member' }), (e: any) => /select fallido/.test(e?.message))
  await assert.rejects(() => ensureBrandMembership(makeAdmin(db, { failUpdateOn: 'organization_members' }), { organizationId: 'org-A', brandId: 'brand-A', userId: 'x', requestedRole: 'member' }), (e: any) => /update fallido/.test(e?.message))
  await assert.rejects(() => ensureBrandMembership(makeAdmin({ organization_members: [] }, { failInsertOn: 'organization_members' }), { organizationId: 'org-A', brandId: 'brand-A', userId: 'n', requestedRole: 'member' }), (e: any) => /insert fallido/.test(e?.message))
})

test('solo existen owner y member: cualquier valor heredado se trata como member, owner solo si is_owner', () => {
  for (const legacy of ['brand_manager', 'finance', 'member', 'super_admin', '', null, undefined]) assert.equal(normalizeBrandRole(legacy as any), 'member', String(legacy))
  assert.equal(normalizeBrandRole('member', true), 'owner')
  assert.equal(officialRoleFor('finance'), 'brand_manager')
  assert.equal(brandMemberRoleFor('brand_manager', true), 'owner')
  assert.equal(brandMemberRoleFor('finance', false), 'member')
  // member tiene lo operativo y nada de equipo/facturación/datos de la marca (igual que el antiguo brand_manager)
  for (const p of ['campaign.manage', 'application.manage', 'influencer.manage', 'location.manage', 'report.read'] as const) assert.equal(roleHasBrandPermission('member', p), true, p)
  for (const p of ['team.manage', 'billing.manage', 'brand.manage', 'financial_document.read', 'legal_document.manage'] as const) assert.equal(roleHasBrandPermission('member', p), false, p)
  assert.equal(roleHasBrandPermission('owner', 'team.manage'), true)
})

test('guardia: invitar/reenviar de marca no hace upsert directo de organization_members (solo transfer_owner)', () => {
  const count = (f: string) => (readFileSync(f, 'utf8').match(/from\('organization_members'\)\.upsert\(/g) ?? []).length
  assert.equal(count('src/app/api/brand/members/route.ts'), 0)
  assert.equal(count('src/app/api/brands/[id]/members/route.ts'), 1, 'solo la transferencia explícita de owner')
  for (const f of ['src/app/api/brands/[id]/members/route.ts', 'src/app/api/brand/members/route.ts']) {
    assert.ok(readFileSync(f, 'utf8').includes('ensureBrandMembership'), `${f}: debe usar ensureBrandMembership`)
  }
})
