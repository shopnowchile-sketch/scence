import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { exactEmailPattern, exactIlikePattern, isPlausibleEmail } from '../src/lib/email-match.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** Emulación mínima de ILIKE de Postgres (\ escapa; % y _ son comodines). */
function ilike(value: string, pattern: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) { re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1 }
    else if (ch === '%') re += '.*'
    else if (ch === '_') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'is').test(value)
}

test('un correo con guion bajo ya no coincide con la marca de otro correo', () => {
  const other = 'aXb@x.cl'
  assert.equal(ilike(other, 'a_b@x.cl'), true, 'caso previo: el comodín _ coincidía con otra marca')
  const pattern = exactEmailPattern('a_b@x.cl')
  assert.ok(pattern)
  assert.equal(ilike(other, pattern), false)
  assert.equal(ilike('A_B@X.cl', pattern), true, 'la comparación exacta sigue ignorando mayúsculas')
})

test('correos con comodines o escapes no se comparan', () => {
  for (const email of ['%@x.cl', 'a*@x.cl', 'a\\b@x.cl', '', '   ']) assert.equal(exactEmailPattern(email), null)
  assert.equal(isPlausibleEmail('persona@marca.cl'), true)
  assert.equal(isPlausibleEmail('sin-arroba'), false)
})

test('las consultas por correo de contacto de marcas usan el patrón exacto', () => {
  for (const file of [
    'src/lib/supabase/ensureOrg.ts',
    'src/app/api/campaigns/[id]/brands/route.ts',
  ]) {
    const source = read(file)
    assert.match(source, /exactEmailPattern/, `${file} debe usar exactEmailPattern`)
    assert.doesNotMatch(source, /\.ilike\('contact_email', (email|contactEmail)\)/, `${file} no debe pasar el correo crudo a ilike`)
  }
})

test('las rutas que editan o borran marcas exigen admin de plataforma antes de tocar datos', () => {
  const source = read('src/app/api/brands/[id]/route.ts')
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const start = source.indexOf(`export async function ${method}(`)
    assert.ok(start >= 0, `falta ${method}`)
    const rest = source.slice(start + 10)
    const next = rest.search(/\nexport async function /)
    const body = next === -1 ? source.slice(start) : source.slice(start, start + 10 + next)
    const guard = body.indexOf('isPlatformAdmin(user.id, admin)')
    const firstData = body.search(/admin\s*\.from\(|admin\.auth/)
    assert.ok(guard >= 0, `${method} sin isPlatformAdmin`)
    assert.ok(firstData === -1 || guard < firstData, `${method}: la autorización debe ir antes de leer o escribir`)
  }
})

test('el listado y la creación administrativa de marcas exigen rol de plataforma', () => {
  const source = read('src/app/api/brands/route.ts')
  for (const method of ['GET', 'POST']) {
    const start = source.indexOf(`export async function ${method}(`)
    const next = source.indexOf('\nexport async function ', start + 10)
    const body = source.slice(start, next === -1 ? undefined : next)
    const guard = body.search(/if \(!isAdmin\)/)
    const firstData = body.search(/admin\s*\.from\(/)
    assert.ok(guard >= 0, `${method} sin comprobación de admin`)
    assert.ok(firstData === -1 || guard < firstData, `${method}: comprobar admin antes de leer datos`)
  }
  assert.doesNotMatch(source, /status:\s*(body|rest)/, 'POST no acepta status desde el cliente')
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

test('ninguna ruta inserta marcas ya aprobadas: toda marca nueva pasa por SCENCE', () => {
  // Regla de negocio (2026-10-22): ser colaboradora de una campaña no equivale
  // a estar aprobada. Si aparece una inserción con 'approved', revisar.
  const root = new URL('../src', import.meta.url).pathname
  const offenders: string[] = []
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\.from\('brands'\)\s*\.insert\(\{[\s\S]*?\}\)\s*\.select/g)) {
      if (/status:[^,\n]*'approved'/.test(match[0])) offenders.push(file.slice(root.length + 1))
    }
  }
  assert.deepEqual(offenders, [])
})

test('el registro de marca nace pending_approval y no acepta status del cliente', () => {
  const register = read('src/lib/supabase/ensureOrg.ts')
  assert.match(register, /status:\s*'pending_approval'/)
  // Los clientes nunca fijan el estado: lo decide register_brand (siempre pending_approval).
  const portal = read('src/app/api/brand/brands/route.ts')
  const call = portal.slice(portal.indexOf('registerBrandAtomic(admin'))
  assert.ok(portal.includes('registerBrandAtomic(admin'))
  assert.doesNotMatch(call.slice(0, call.indexOf('})') + 2), /status/, 'POST /api/brand/brands no pasa status')
  assert.match(read('src/app/api/auth/register-brand/route.ts'), /ensureBrandRow\(newUser\.user\)/)
})

test('la marca colaboradora sin correo nace pending_approval', () => {
  const source = read('src/app/api/campaigns/[id]/brands/route.ts')
  assert.doesNotMatch(source, /status:\s*email \?/)
  assert.doesNotMatch(source, /status:\s*'approved'/)
  assert.match(source, /matched: false, pending: true/)
})

test('el alta de marca por influencer compara nombres sin comodines', () => {
  const source = read('src/app/api/influencer/owned-brands/route.ts')
  assert.match(source, /exactIlikePattern/)
  assert.doesNotMatch(source, /\.ilike\('name', name\)/)
  assert.equal(exactIlikePattern('Marca_1'), 'Marca\\_1')
  assert.equal(exactIlikePattern('100% real'), null)
})
