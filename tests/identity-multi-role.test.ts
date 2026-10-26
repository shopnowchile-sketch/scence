import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canEnterBrandPortal, canEnterInfluencerPortal, defaultPortalPath } from '../src/lib/portal-access.ts'
import { roleHasBrandPermission } from '../src/lib/brand-permissions.ts'

const brand = { brandId: 'brand-A', organizationId: 'org-A', role: 'member' as const, isOwner: false }

test('una identidad dual conserva acceso explícito a ambos portales', () => {
  const dual = { isPlatformAdmin: false, isInfluencer: true, brand }
  assert.equal(defaultPortalPath(dual), '/inf-dash')
  assert.equal(canEnterInfluencerPortal(dual), true)
  assert.equal(canEnterBrandPortal(dual), true)
})

test('la membresía de marca no convierte a una influencer en admin de plataforma', () => {
  const brandOnly = { isPlatformAdmin: false, isInfluencer: false, brand }
  assert.equal(defaultPortalPath(brandOnly), '/brand-dash')
  assert.equal(canEnterInfluencerPortal(brandOnly), false)
  assert.equal(canEnterBrandPortal({ ...brandOnly, brand: null }), false)
})

test('los permisos de marca preservan los límites de cada rol', () => {
  // Una marca tiene solo owner y member; 'brand_manager' y 'finance' heredados se tratan como member.
  assert.equal(roleHasBrandPermission('owner', 'billing.read'), true)
  assert.equal(roleHasBrandPermission('member', 'campaign.manage'), true)
  assert.equal(roleHasBrandPermission('brand_manager', 'campaign.manage'), true)
  assert.equal(roleHasBrandPermission('finance', 'billing.read'), false)
  assert.equal(roleHasBrandPermission('member', 'team.manage'), false)
})

test('middleware no usa metadata de Auth para autorizar portales', () => {
  const source = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /claims\.user_metadata/)
  assert.match(source, /from\('organization_members'\)/)
  for (const route of ['/brand-billing', '/brand-brands', '/brand-documents', '/brand-settings', '/brand-opportunities']) {
    assert.match(source, new RegExp(`'${route}'`))
  }
})

test('las invitaciones reutilizan la búsqueda paginada y no reescriben metadata existente', () => {
  const ownerInvite = readFileSync(new URL('../src/app/api/brands/[id]/invite/route.ts', import.meta.url), 'utf8')
  const teamInvite = readFileSync(new URL('../src/app/api/settings/team/invite/route.ts', import.meta.url), 'utf8')
  const brandMembers = readFileSync(new URL('../src/app/api/brand/members/route.ts', import.meta.url), 'utf8')
  const adminBrandMembers = readFileSync(new URL('../src/app/api/brands/[id]/members/route.ts', import.meta.url), 'utf8')

  for (const source of [ownerInvite, teamInvite, brandMembers, adminBrandMembers]) {
    assert.match(source, /findAuthUserByEmail/)
  }
  const existingOwnerBranch = ownerInvite.slice(ownerInvite.indexOf('if (existingUser) {'), ownerInvite.indexOf('} else {', ownerInvite.indexOf('if (existingUser) {')))
  assert.doesNotMatch(existingOwnerBranch, /updateUserById/)
})

test('ninguna organización se crea por iniciar sesión: ensureOrg es interna', () => {
  const lib = readFileSync(new URL('../src/lib/supabase/ensureOrg.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(lib, /export (async )?function ensureOrg\b/)
  for (const file of ['../src/app/(dashboard)/layout.tsx', '../src/app/(influencer)/layout.tsx', '../src/middleware.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /await ensureOrg\(|import \{[^}]*\bensureOrg\b[^}]*\}/)
  }
})
