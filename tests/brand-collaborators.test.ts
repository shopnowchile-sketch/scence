// M5 — pruebas PURAS y ESTÁTICAS (decisión de acceso, normalizador, texto de la migración y de la ruta).
// El comportamiento de GET/POST/DELETE se ejecuta en tests/brand-collaborators-routes.test.ts (base en memoria,
// simulada: no es PostgreSQL). Nada de esto sustituye una prueba de integración en una base aislada.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { decideCollaboratorAccess, COLLABORATOR_BRAND_FIELDS, UUID_RE } from '../src/lib/brand-collaborators.ts'
import { roleHasBrandPermission, type BrandRole } from '../src/lib/brand-permissions.ts'
import { brandStatusAllows } from '../src/lib/brand-status-access.ts'
import { normalizeInstagramHandle } from '../src/lib/brands/instagram.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
// Misma composición que hasBrandPermission(access, permiso, 'operate') de ensureOrg.
const can = (role: BrandRole, status: string | null, p: 'brand.read' | 'team.manage') =>
  roleHasBrandPermission(role, p) && brandStatusAllows(status, 'operate')
const brandUser = (role: BrandRole, status: string | null = 'approved', brandId = A) =>
  ({ brandId, canRead: can(role, status, 'brand.read'), canManage: can(role, status, 'team.manage') })

// ── Permisos ─────────────────────────────────────────────────────────────
test('owner aprobado puede leer y modificar la lista de SU marca', () => {
  for (const action of ['read', 'manage'] as const) {
    const d = decideCollaboratorAccess({ isPlatformAdmin: false, access: brandUser('owner'), action, requestedBrandId: null })
    assert.deepEqual(d, { ok: true, brandId: A, actor: 'brand' })
  }
})

test('roles no owner (member, brand_manager, finance) consultan pero no modifican', () => {
  for (const role of ['member', 'brand_manager', 'finance'] as const) {
    const read = decideCollaboratorAccess({ isPlatformAdmin: false, access: brandUser(role), action: 'read', requestedBrandId: null })
    assert.equal(read.ok, true, `${role} read`)
    const manage = decideCollaboratorAccess({ isPlatformAdmin: false, access: brandUser(role), action: 'manage', requestedBrandId: null })
    assert.equal(manage.ok, false, `${role} manage`)
  }
})

test('una marca no aprobada no opera aunque sea owner', () => {
  for (const status of ['pending_approval', 'rejected', 'suspended', null, 'archived']) {
    for (const action of ['read', 'manage'] as const) {
      const d = decideCollaboratorAccess({ isPlatformAdmin: false, access: brandUser('owner', status), action, requestedBrandId: null })
      assert.equal(d.ok, false, `${status}/${action}`)
    }
  }
})

test('sin membresía de marca: 403', () => {
  const d = decideCollaboratorAccess({ isPlatformAdmin: false, access: null, action: 'read', requestedBrandId: A })
  assert.deepEqual(d, { ok: false, status: 403, error: 'Forbidden' })
})

test('acceso cruzado: un brand_id ajeno en el payload se rechaza, también para owner', () => {
  for (const action of ['read', 'manage'] as const) {
    const d = decideCollaboratorAccess({ isPlatformAdmin: false, access: brandUser('owner'), action, requestedBrandId: B })
    assert.equal(d.ok, false)
    if (!d.ok) assert.equal(d.status, 403)
  }
})

test('super_admin opera sobre la marca indicada y debe indicarla', () => {
  for (const action of ['read', 'manage'] as const) {
    assert.deepEqual(
      decideCollaboratorAccess({ isPlatformAdmin: true, access: null, action, requestedBrandId: B }),
      { ok: true, brandId: B, actor: 'platform_admin' },
    )
    const sin = decideCollaboratorAccess({ isPlatformAdmin: true, access: null, action, requestedBrandId: null })
    assert.equal(sin.ok, false)
  }
})

// ── Identidad por Instagram ──────────────────────────────────────────────
test('variantes del mismo Instagram resuelven a la misma clave', () => {
  const variants = ['@Foo.Bar', 'foo.bar', ' FOO.BAR ', 'https://www.instagram.com/foo.bar/', 'https://instagram.com/Foo.Bar?hl=es']
  for (const v of variants) assert.equal(normalizeInstagramHandle(v), 'foo.bar', v)
})

test('Instagram inválido o vacío no produce clave (nunca se adivina)', () => {
  for (const v of ['', '   ', null, undefined, 'https://evil.com/foo', 'a b', 'x'.repeat(31), '@@']) {
    assert.equal(normalizeInstagramHandle(v), null, String(v))
  }
})

// ── Migración (estática; la concurrencia real requiere base aislada) ─────
const sql = read('supabase/migrations/20261023120000_brand_collaborators.sql')

test('migración: unicidad, sin autorrelación, FKs a brands y RLS cerrado', () => {
  assert.match(sql, /unique \(brand_id, collaborator_brand_id\)/i)
  assert.match(sql, /check \(brand_id <> collaborator_brand_id\)/i)
  assert.match(sql, /foreign key \(brand_id\) references public\.brands\(id\) on delete cascade/i)
  assert.match(sql, /foreign key \(collaborator_brand_id\) references public\.brands\(id\) on delete cascade/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on table public\.brand_collaborators from public, anon, authenticated/i)
})

test('migración: GRANT mínimo a service_role (SELECT, INSERT, DELETE) y nada más; sin privilegios para anon/authenticated', () => {
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const grants = code.match(/grant [^;]+;/gi) ?? []
  assert.deepEqual(grants.map(g => g.replace(/\s+/g, ' ').toLowerCase()), ['grant select, insert, delete on table public.brand_collaborators to service_role;'])
  assert.match(code, /revoke all on table public\.brand_collaborators from public, anon, authenticated;/i)
  assert.ok(code.indexOf('revoke all') < code.indexOf('grant select'), 'primero se revoca, luego se concede lo mínimo')
})

test('migración: no crea políticas, no toca RLS/roles/membresías ni campaign_brands, sin backfill', () => {
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /create policy|drop policy|alter policy/i)
  assert.doesNotMatch(code, /organization_members|campaign_brands|brand_members|insert into/i)
  assert.doesNotMatch(code, /drop table|truncate|delete from/i)
})

// ── Ruta (estática) ──────────────────────────────────────────────────────
const route = read('src/app/api/brand/collaborators/route.ts')
const routeCode = route.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

test('ruta: crea solo relaciones con marcas existentes (sin registerBrand) y sin tocar campaign_brands', () => {
  assert.doesNotMatch(routeCode, /registerBrandAtomic|register_brand|provisionOrgForBrand|\.from\('brands'\)\s*\.insert/)
  assert.doesNotMatch(routeCode, /campaign_brands|organization_members|brand_members/)
  assert.match(route, /brand_not_found_creation_disabled/)
})

test('ruta: toda operación pasa por authorize() y la marca sale de la decisión, no del body', () => {
  for (const verb of ['GET', 'POST', 'DELETE']) assert.match(route, new RegExp(`export async function ${verb}`))
  assert.equal((route.match(/await authorize\(/g) ?? []).length, 3)
  assert.match(route, /23505/)
  assert.match(route, /hasBrandPermission\(access, 'brand\.read', 'operate'\)/)
  assert.match(route, /hasBrandPermission\(access, 'team\.manage', 'operate'\)/)
})

test('ruta: solo expone nombre, logo, Instagram y estado de la colaboradora', () => {
  assert.equal(COLLABORATOR_BRAND_FIELDS, 'id, name, logo_url, instagram')
  assert.doesNotMatch(COLLABORATOR_BRAND_FIELDS, /status/, 'el estado de aprobación no se expone a otras marcas')
  assert.match(route, /\.eq\('status', 'approved'\)/, 'la búsqueda se limita a marcas aprobadas')
  assert.doesNotMatch(route, /contact_email|metadata|organization_id|user_id|created_by,/)
  assert.ok(UUID_RE.test(A))
})
