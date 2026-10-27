// T1 — análisis estático: no existen vías alternativas a las barreras. Sin red.
//   node --test tests/nonprod-safety-static.test.ts
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git' || name === '.claude') continue
    const p = join(dir, name)
    statSync(p).isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
const rel = (p: string) => relative(ROOT, p)
const src = walk(join(ROOT, 'src')).filter(f => /\.(ts|tsx|js|mjs)$/.test(f))
const read = (p: string) => readFileSync(p, 'utf8')

test('el host de PayPal Live solo aparece en src/lib/paypal-env.ts', () => {
  const offenders = src.filter(f => rel(f) !== 'src/lib/paypal-env.ts' && read(f).includes('api-m.paypal.com')).map(rel)
  assert.deepEqual(offenders, [])
})
test('PAYPAL_ENV solo se lee en src/lib/paypal-env.ts', () => {
  const offenders = src.filter(f => rel(f) !== 'src/lib/paypal-env.ts' && /process\.env\.PAYPAL_ENV/.test(read(f))).map(rel)
  assert.deepEqual(offenders, [])
})
test('Resend solo se instancia en src/lib/resend.ts, tras la barrera', () => {
  const offenders = src.filter(f => rel(f) !== 'src/lib/resend.ts' && /new Resend\(/.test(read(f))).map(rel)
  assert.deepEqual(offenders, [])
  const text = read(join(ROOT, 'src/lib/resend.ts'))
  assert.ok(text.indexOf('isProductionRuntime()') < text.indexOf('new Resend('), 'la barrera va antes de crear el cliente real')
  assert.equal((text.match(/new Resend\(/g) ?? []).length, 1)
})
test('toda creación de cliente Supabase de servidor pasa por la barrera de BD', () => {
  const text = read(join(ROOT, 'src/lib/supabase/server.ts'))
  assert.equal((text.match(/assertDatabaseTargetAllowed\(\)/g) ?? []).length, 2) // _buildClient + createAdminClient
  const offenders = src.filter(f => !rel(f).startsWith('src/lib/supabase/') && rel(f) !== 'src/middleware.ts' && /createServerClient\(\s*process\.env|createClient\(\s*process\.env/.test(read(f))).map(rel)
  assert.deepEqual(offenders, [])
})
test('el middleware aplica la barrera antes de tocar Supabase o cookies', () => {
  const text = read(join(ROOT, 'src/middleware.ts'))
  const guard = text.indexOf('nonProductionDatabaseBlock()')
  assert.ok(guard > 0)
  assert.ok(guard < text.indexOf('createServerClient('))
  assert.ok(guard < text.indexOf('request.cookies'))
})
test('Calendar, Apify y Meta dependen de la barrera de producción', () => {
  assert.match(read(join(ROOT, 'src/lib/google-calendar.ts')), /assertProductionRuntime\('Google Calendar'\)/)
  assert.match(read(join(ROOT, 'src/lib/deliverables/apify-metrics.ts')), /productionEnv\('APIFY_API_TOKEN'\)/)
  assert.match(read(join(ROOT, 'src/lib/meta-instagram.ts')), /isProductionRuntime\(\)/)
  assert.match(read(join(ROOT, 'src/lib/instagram/business-discovery.ts')), /isProductionRuntime\(\)/)
  assert.match(read(join(ROOT, 'src/lib/instagram/followers-sync.ts')), /productionEnv\('META_IG_SYSTEM_TOKEN'\)/)
})
test('los scripts de PayPal usan el selector seguro y no nombran el host Live', () => {
  for (const f of ['create-paypal-plans', 'paypal-add-payment-events', 'paypal-webhook-diagnostics', 'backfill-subscription-payments']) {
    const text = read(join(ROOT, `scripts/${f}.mjs`))
    assert.match(text, /resolvePayPalTarget/, f)
    assert.ok(!text.includes('api-m.paypal.com'), f)
  }
})
test('MercadoPago no se toca: ningún archivo de la capa lo menciona', () => {
  const guards = ['src/lib/runtime-env.ts', 'src/lib/paypal-env.ts', 'src/lib/resend-blocked.ts', 'scripts/lib/paypal-target.mjs']
  for (const f of guards) assert.ok(!/mercado/i.test(read(join(ROOT, f))), f)
})
