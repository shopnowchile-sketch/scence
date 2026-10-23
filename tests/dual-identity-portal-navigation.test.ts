import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ADMIN_ONLY, BRAND_ONLY, INFLUENCER_ONLY,
  decidePortalRedirect, needsBrandMembershipCheck, type PortalFlags,
} from '../src/lib/portal-navigation.ts'

// Pruebas UNITARIAS/ESTÁTICAS de la decisión de navegación. No son pruebas de
// integración: no arrancan Next ni Supabase. La autorización real vive en las APIs.

const ADMIN: PortalFlags = { isBrand: false, isInfluencer: false }
const INF: PortalFlags = { isBrand: false, isInfluencer: true }
const BRAND: PortalFlags = { isBrand: true, isInfluencer: false }
const DUAL: PortalFlags = { isBrand: true, isInfluencer: true }
const ALL_FLAGS: [string, PortalFlags][] = [['admin', ADMIN], ['influencer', INF], ['brand', BRAND], ['dual', DUAL]]

const PATHS = [
  '/', '/login', '/dashboard', '/brand/dashboard', '/influencers/support', '/algo-desconocido',
  ...ADMIN_ONLY, ...INFLUENCER_ONLY, ...BRAND_ONLY,
  ...[...ADMIN_ONLY, ...INFLUENCER_ONLY, ...BRAND_ONLY].map(r => r + '/sub/ruta'),
  '/brand-billing', '/brand-settings/organization', '/brand-opportunities', '/admin-requirements',
]

// Referencia: la lógica EXACTA de origin/master (ad7f76c) antes del hotfix.
function masterReference(f: PortalFlags, path: string): string | null {
  if (f.isBrand) {
    if (path === '/login' || path === '/' || path === '/brand/dashboard') return '/brand-dash'
    if (ADMIN_ONLY.some(r => path.startsWith(r)) || INFLUENCER_ONLY.some(r => path.startsWith(r))) return '/brand-dash'
  } else if (f.isInfluencer) {
    if (path === '/login' || path === '/' || path === '/dashboard') return '/inf-dash'
    if (ADMIN_ONLY.some(r => path.startsWith(r)) && path !== '/influencers/support') return '/inf-dash'
    if (BRAND_ONLY.some(r => path.startsWith(r))) return '/inf-dash'
  } else {
    if (path === '/login' || path === '/') return '/admin-dash'
    if (INFLUENCER_ONLY.some(r => path === r || path.startsWith(r + '/'))) return '/admin-dash'
    if (BRAND_ONLY.some(r => path.startsWith(r))) return '/admin-dash'
  }
  return null
}

test('admin y marca (solo is_brand) se comportan EXACTAMENTE como antes del hotfix', () => {
  for (const [, f] of [['admin', ADMIN], ['brand', BRAND]] as const) {
    for (const path of PATHS) {
      assert.equal(decidePortalRedirect(f, path), masterReference(f, path), `${JSON.stringify(f)} ${path}`)
      assert.equal(decidePortalRedirect(f, path, true), masterReference(f, path), `${JSON.stringify(f)} ${path} (membresía irrelevante)`)
    }
  }
})

test('influencer (solo is_influencer) SIN membresía se comporta EXACTAMENTE como antes', () => {
  for (const path of PATHS) assert.equal(decidePortalRedirect(INF, path, false), masterReference(INF, path), path)
})

test('influencer CON membresía: solo cambian las rutas de marca; todo lo demás igual que antes', () => {
  for (const path of PATHS) {
    const before = masterReference(INF, path)
    const after = decidePortalRedirect(INF, path, true)
    const isBrandPath = BRAND_ONLY.some(r => path.startsWith(r))
    if (isBrandPath) {
      assert.equal(after, path === '/brand/dashboard' ? '/brand-dash' : null, `ruta de marca ${path}`)
    } else {
      assert.equal(after, before, path)
    }
  }
})

test('identidad dual: ambos portales, entrada histórica por influencer, sin admin', () => {
  for (const p of ['/login', '/', '/dashboard']) assert.equal(decidePortalRedirect(DUAL, p), '/inf-dash', p)
  for (const p of ['/inf-dash', '/inf-campaigns', '/inf-brands', '/inf-deliverables/abc']) assert.equal(decidePortalRedirect(DUAL, p), null, p)
  for (const p of ['/brand-dash', '/brand-campaigns', '/brand-billing', '/brand-settings/organization', '/brand-opportunities']) assert.equal(decidePortalRedirect(DUAL, p), null, p)
  assert.equal(decidePortalRedirect(DUAL, '/brand/dashboard'), '/brand-dash')
  for (const p of ADMIN_ONLY) assert.equal(decidePortalRedirect(DUAL, p), '/inf-dash', `admin bloqueado: ${p}`)
})

test('límite de autorización: ninguna combinación de banderas abre rutas de admin', () => {
  for (const [name, f] of ALL_FLAGS) {
    if (name === 'admin') continue
    for (const p of ADMIN_ONLY) {
      for (const membership of [false, true]) {
        const r = decidePortalRedirect(f, p, membership)
        assert.ok(r && !ADMIN_ONLY.some(a => r.startsWith(a)), `${name} ${p} -> ${r}`)
      }
    }
  }
  // Y el admin sin banderas sigue sin entrar a portales de marca/influencer.
  for (const p of [...BRAND_ONLY, ...INFLUENCER_ONLY]) assert.equal(decidePortalRedirect(ADMIN, p, true), '/admin-dash', p)
})

test('la membresía solo se consulta para influencer-sin-marca en rutas de marca', () => {
  for (const [name, f] of ALL_FLAGS) {
    for (const path of PATHS) {
      const expected = name === 'influencer' && BRAND_ONLY.some(r => path.startsWith(r))
      assert.equal(needsBrandMembershipCheck(f, path), expected, `${name} ${path}`)
    }
  }
})

test('sin bucles de redirección: toda cadena termina en ≤2 saltos (incluye dual SIN ficha de influencer)', () => {
  for (const [name, f] of ALL_FLAGS) {
    for (const membership of [false, true]) {
      for (const start of PATHS) {
        let path = start
        let hops = 0
        for (; hops < 4; hops++) {
          const next = decidePortalRedirect(f, path, membership)
          if (!next) break
          path = next
        }
        assert.ok(hops <= 2, `bucle: ${name} membership=${membership} desde ${start} (${hops} saltos, termina en ${path})`)
      }
    }
  }
})

test('sin sesión: el middleware responde antes de decidir portales (API → 401 JSON, páginas → /login)', () => {
  const src = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
  const noClaims = src.indexOf('if (!claims) {')
  const decide = src.indexOf('decidePortalRedirect(flags')
  assert.ok(noClaims > 0 && decide > noClaims, 'la rama sin sesión debe ir antes de la decisión de portales')
  const block = src.slice(noClaims, decide)
  assert.match(block, /status: 401/)
  assert.match(block, /pathname = '\/login'/)
  // Las rutas públicas siguen saliendo antes de cualquier verificación de sesión.
  assert.ok(src.indexOf('if (isPublic)') < src.indexOf('getClaims()'))
})

test('el middleware solo LEE (sin escrituras) y la consulta de membresía es propia, activa y de roles de marca', () => {
  const src = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete|rpc)\(|updateUserById|createAdminClient|ensureInfluencerRow|ensureOrg/)
  assert.match(src, /needsBrandMembershipCheck\(flags, path\)/)
  assert.match(src, /\.from\('organization_members'\)/)
  assert.match(src, /\.eq\('user_id', claims\.sub\)/)
  assert.match(src, /\.eq\('is_active', true\)/)
  assert.match(src, /\.in\('role', \['brand_manager', 'finance', 'member'\]\)/)
  const nav = readFileSync(new URL('../src/lib/portal-navigation.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(nav, /^\s*import /m, 'la decisión debe ser pura (sin imports)')
})

test('«Cambiar portal» solo navega: enlaces simples, condicionados y sin tocar ensureInfluencerRow', () => {
  const infSidebar = readFileSync(new URL('../src/app/(influencer)/_components/InfluencerSidebar.tsx', import.meta.url), 'utf8')
  const brandSidebar = readFileSync(new URL('../src/app/(brand)/_components/BrandSidebar.tsx', import.meta.url), 'utf8')
  const layout = readFileSync(new URL('../src/app/(influencer)/layout.tsx', import.meta.url), 'utf8')

  assert.match(infSidebar, /hasBrandAccess = false/)
  assert.match(infSidebar, /href: '\/brand-dash'/)
  assert.match(brandSidebar, /fetch\('\/api\/influencer\/me'/)
  assert.match(brandSidebar, /setHasInfluencerProfile\(response\.ok\)/)
  assert.match(brandSidebar, /href: '\/inf-dash'/)
  assert.doesNotMatch(infSidebar + brandSidebar, /method:\s*'(POST|PUT|PATCH|DELETE)'/)

  assert.match(layout, /resolveBrandAccess\(user\.id\)/)
  assert.match(layout, /hasBrandAccess=\{brandAccess !== null\}/)
  // ensureInfluencerRow sigue llamándose igual y antes de leer el estado del perfil.
  assert.match(layout, /await ensureInfluencerRow\(user\)\n\s*const \[profileState, brandAccess\]/)
})
