import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { BRAND_STATUSES, brandStatusAllows, capabilityForPermission } from '../src/lib/brand-status-access.ts'
import { decideBrandRegistration, registrationKey, type RegistrationActor } from '../src/lib/brand-registration-policy.ts'

const root = new URL('../', import.meta.url).pathname
const read = (path: string) => readFileSync(join(root, path), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

// ── P3: matriz de estados ────────────────────────────────────────────────
test('los cuatro estados permiten exactamente lo definido', () => {
  const caps = ['status', 'profile', 'onboarding', 'billing', 'billing_manage', 'operate'] as const
  const expected: Record<string, string[]> = {
    pending_approval: ['status', 'profile', 'onboarding', 'billing'],
    approved: ['status', 'profile', 'onboarding', 'billing', 'billing_manage', 'operate'],
    rejected: ['status'],
    suspended: ['status', 'billing', 'billing_manage'],
  }
  assert.deepEqual([...BRAND_STATUSES].sort(), Object.keys(expected).sort())
  for (const status of BRAND_STATUSES) {
    for (const cap of caps) {
      assert.equal(brandStatusAllows(status, cap), expected[status].includes(cap), `${status}/${cap}`)
    }
  }
})

test('estado desconocido, nulo o vacío falla cerrado (solo ver estado)', () => {
  for (const status of [null, undefined, '', 'archived', 'APPROVED', 'approved ']) {
    assert.equal(brandStatusAllows(status, 'operate'), false, String(status))
    assert.equal(brandStatusAllows(status, 'billing'), false, String(status))
    assert.equal(brandStatusAllows(status, 'status'), true, String(status))
  }
})

test('solo las marcas aprobadas operan; suspendida solo factura', () => {
  assert.equal(brandStatusAllows('approved', 'operate'), true)
  for (const s of ['pending_approval', 'rejected', 'suspended']) assert.equal(brandStatusAllows(s, 'operate'), false, s)
  assert.equal(brandStatusAllows('suspended', 'profile'), false)
  assert.equal(brandStatusAllows('rejected', 'billing'), false)
})

test('cada permiso de rol se traduce a la capacidad de estado correcta', () => {
  assert.equal(capabilityForPermission('brand.read'), 'status')
  assert.equal(capabilityForPermission('brand.manage'), 'profile')
  assert.equal(capabilityForPermission('billing.read'), 'billing')
  assert.equal(capabilityForPermission('financial_document.read'), 'billing')
  assert.equal(capabilityForPermission('billing.manage'), 'billing_manage')
  assert.equal(capabilityForPermission('financial_document.manage'), 'billing_manage')
  assert.equal(capabilityForPermission('legal_document.manage'), 'onboarding')
  assert.equal(capabilityForPermission('campaign.manage' as never), 'operate')
})

test('hasBrandPermission aplica el estado en el servidor (no solo en la interfaz)', () => {
  const src = read('src/lib/supabase/ensureOrg.ts')
  const fn = src.slice(src.indexOf('export function hasBrandPermission'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.match(body, /brandStatusAllows\(\s*access\.status/)
  assert.match(body, /capabilityForPermission/)
})

// ── P4: quién puede registrar marcas ────────────────────────────────────
const base: RegistrationActor = { emailVerified: true, banned: false, isPlatformAdmin: false, influencer: null, brand: null }

test('registro de marcas por tipo de usuario', () => {
  const cases: Array<[string, Partial<RegistrationActor>, string]> = [
    ['admin de plataforma', { isPlatformAdmin: true }, 'platform_admin'],
    ['influencer activa verificada', { influencer: { isActive: true } }, 'influencer'],
    ['marca aprobada con permiso de perfil', { brand: { operates: true, canManageProfile: true } }, 'brand'],
  ]
  for (const [label, patch, as] of cases) {
    const d = decideBrandRegistration({ ...base, ...patch })
    assert.deepEqual(d, { allowed: true, as }, label)
  }
})

test('registro denegado: sin verificar, inactiva, marca no aprobada, sin permiso, sin rol', () => {
  const denied: Array<[string, Partial<RegistrationActor>, string]> = [
    ['sin verificar (incluso admin)', { emailVerified: false, isPlatformAdmin: true }, 'unverified'],
    ['sin verificar (influencer)', { emailVerified: false, influencer: { isActive: true } }, 'unverified'],
    ['cuenta bloqueada', { banned: true, influencer: { isActive: true } }, 'inactive'],
    ['influencer inactiva', { influencer: { isActive: false } }, 'inactive'],
    ['marca pendiente', { brand: { operates: false, canManageProfile: true } }, 'brand_not_approved'],
    ['marca suspendida/rechazada', { brand: { operates: false, canManageProfile: false } }, 'brand_not_approved'],
    ['marca aprobada sin permiso de perfil', { brand: { operates: true, canManageProfile: false } }, 'not_authorized'],
    ['sin ningún rol', {}, 'not_authorized'],
  ]
  for (const [label, patch, reason] of denied) {
    assert.deepEqual(decideBrandRegistration({ ...base, ...patch }), { allowed: false, reason }, label)
  }
})

test('la clave de idempotencia es estable y distingue personas y marcas', () => {
  const a = registrationKey('u1', { contact_email: ' Foo@X.cl ' })
  assert.equal(a, registrationKey('u1', { contact_email: 'foo@x.cl' }))
  assert.notEqual(a, registrationKey('u2', { contact_email: 'foo@x.cl' }))
  assert.notEqual(a, registrationKey('u1', { contact_email: 'bar@x.cl' }))
  assert.equal(registrationKey('u1', { instagram_handle_normalized: 'Marca', name: 'x' }), 'u1:marca')
})

// ── P4: ninguna ruta crea marcas fuera de register_brand ────────────────
test('ninguna ruta ni librería inserta en brands directamente (solo register_brand)', () => {
  const offenders: string[] = []
  for (const file of walk('src')) {
    
    const src = read(file)
    if (/from\(\s*['"]brands['"]\s*\)\s*\.insert\(/.test(src) || /from\(\s*['"]brands['"]\s*\)\s*\n\s*\.insert\(/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

test('ninguna ruta crea organizaciones sueltas para marcas', () => {
  const offenders = walk('src/app').filter(f => /from\(\s*['"]organizations['"]\s*\)\s*\.insert\(/.test(read(f)) || /provisionOrgForBrand\(/.test(read(f)))
  assert.deepEqual(offenders, [])
})

test('la migración fija pending_approval, bloquea la ejecución a clientes y es idempotente', () => {
  const sql = read('supabase/migrations/20261022160000_register_brand_atomic.sql')
  assert.match(sql, /'pending_approval'/)
  assert.match(sql, /revoke all on function public\.register_brand[\s\S]*from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.register_brand[\s\S]*to service_role/i)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /create unique index if not exists brands_registration_key_unique/i)
})

test('los puntos de alta usan register_brand con clave de idempotencia', () => {
  const sites: Array<[string, RegExp]> = [
    ['src/app/api/brands/route.ts', /registerBrandAtomic/],
    ['src/app/api/brand/brands/route.ts', /registerBrandAtomic/],
    ['src/app/api/influencer/owned-brands/route.ts', /registerBrandAtomic/],
    ['src/app/api/campaigns/[id]/brands/route.ts', /registerBrandAtomic[\s\S]*registerBrandAtomic/],
    ['src/app/api/crm-leads/[id]/route.ts', /key: `crm_lead:\$\{params\.id\}`/],
    ['src/lib/supabase/ensureOrg.ts', /key: `self:\$\{user\.id\}`/],
  ]
  for (const [file, re] of sites) assert.match(read(file), re, file)
})

// ── Tokens de Google / Stripe en organizations ──────────────────────────
test('ninguna ruta devuelve organizations con select(*) ni select() abierto', () => {
  const offenders: string[] = []
  for (const file of walk('src')) {
    const src = read(file)
    for (const m of src.matchAll(/from\(\s*['"]organizations['"]\s*\)([\s\S]{0,300}?)(?:\n\s*\n|;|$)/g)) {
      if (/\.select\(\s*(['"`]\*['"`])?\s*\)/.test(m[1])) offenders.push(file)
    }
  }
  assert.deepEqual([...new Set(offenders)], [])
})

test('settings/organization usa una lista explícita de columnas sin tokens', () => {
  const src = read('src/app/api/settings/organization/route.ts')
  const cols = src.match(/ORGANIZATION_PUBLIC_COLUMNS =\s*'([^']+)'/)?.[1] ?? ''
  assert.ok(cols.length > 0)
  assert.doesNotMatch(cols, /google|stripe|settings/)
  assert.equal((src.match(/select\(ORGANIZATION_PUBLIC_COLUMNS\)/g) ?? []).length, 2, 'GET y PATCH')
})

test('registerBrand falla cerrado: sin register_brand no crea organizaciones ni marcas', () => {
  const src = read('src/lib/supabase/registerBrand.ts')
  assert.doesNotMatch(src, /from\(\s*['"](organizations|brands)['"]\s*\)\s*\.insert/)
  assert.match(src, /register_brand_unavailable/)
})

test('marca pendiente: consulta facturación y completa registro, pero no emite ni opera', () => {
  for (const cap of ['status', 'profile', 'onboarding', 'billing'] as const) assert.equal(brandStatusAllows('pending_approval', cap), true, cap)
  for (const cap of ['billing_manage', 'operate'] as const) assert.equal(brandStatusAllows('pending_approval', cap), false, cap)
})

test('registrar una marca no crea membresías: solo el autorregistro pasa ownerUserId', () => {
  const offenders = walk('src').filter(f => /\bownerUserId\b/.test(read(f)) && !/registerBrand\.ts$|ensureOrg\.ts$/.test(f))
  assert.deepEqual(offenders, [])
  assert.doesNotMatch(read('src/lib/supabase/registerBrand.ts').split('export async function authorizeBrandRegistration')[0], /organization_members/)
})

test('brand.manage solo lo tiene el rol owner y se evalúa sobre la marca del propio usuario', () => {
  const perms = read('src/lib/brand-permissions.ts')
  const withManage = [...perms.matchAll(/^  (\w+): new Set<BrandPermission>\(\[([\s\S]*?)\]\),?$/gm)].filter(m => m[2].includes("'brand.manage'")).map(m => m[1])
  assert.deepEqual(withManage, ['owner'])
  assert.doesNotMatch(perms, /super_admin|platform/)
})

test('factura: la marca pendiente consulta pero no gestiona (verificado en código y rutas)', () => {
  const access = read('src/lib/invoice-access.ts')
  assert.match(access, /roleHasBrandPermission\(brand\.role, 'billing\.manage'\) && \(input\.brandCanManage \?\? true\)/)
  assert.match(read('src/lib/invoice-authorize.ts'), /brandCanManage: actor\.brand \? brandStatusAllows\(actor\.brand\.status, 'billing_manage'\)/)
  // POST /api/invoices exige billing.manage vía hasBrandPermission, que ya es sensible al estado.
  assert.match(read('src/app/api/invoices/route.ts'), /hasBrandPermission\(brandAccess, 'billing\.manage'\)/)
})
