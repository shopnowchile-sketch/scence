// Capa A — scripts de PayPal: Sandbox y dry-run por defecto. Sin red.
//   node --test tests/nonprod-safety-scripts.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const T = await import('../scripts/lib/paypal-target.mjs')
const RT = await import('../src/lib/runtime-env.ts').catch(() => null)
const CONFIRM = `--confirm-live=${T.LIVE_CONFIRMATION}`
const liveEnv = { PAYPAL_ENV: 'live' }

describe('resolvePayPalTarget', () => {
  test('por defecto: Sandbox + dry-run, aunque el archivo de entorno diga live', () => {
    const t = T.resolvePayPalTarget({ argv: [], env: liveEnv, processEnv: {} })
    assert.equal(t.mode, 'sandbox'); assert.equal(t.base, T.PAYPAL_SANDBOX_BASE_URL); assert.equal(t.dryRun, true)
    assert.ok(t.notes.some((n: string) => n.includes('IGNORADO')))
  })
  test('--apply solo no activa Live', () => {
    const t = T.resolvePayPalTarget({ argv: ['--apply'], env: liveEnv, processEnv: {} })
    assert.equal(t.mode, 'sandbox'); assert.equal(t.dryRun, false)
  })
  test('Live exige --live + confirmación + PAYPAL_ENV=live', () => {
    assert.throws(() => T.resolvePayPalTarget({ argv: ['--live'], env: liveEnv, processEnv: {} }), /--confirm-live/)
    assert.throws(() => T.resolvePayPalTarget({ argv: ['--live', '--confirm-live=si'], env: liveEnv, processEnv: {} }), /--confirm-live/)
    assert.throws(() => T.resolvePayPalTarget({ argv: ['--live', CONFIRM], env: { PAYPAL_ENV: 'sandbox' }, processEnv: {} }), /PAYPAL_ENV=live/)
    const ok = T.resolvePayPalTarget({ argv: ['--live', CONFIRM], env: liveEnv, processEnv: {} })
    assert.equal(ok.mode, 'live'); assert.equal(ok.base, T.PAYPAL_LIVE_BASE_URL); assert.equal(ok.dryRun, true)
  })
  test('Live nunca desde un entorno de pruebas', () => {
    for (const processEnv of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { NODE_ENV: 'test' }, { NODE_ENV: 'development' }, { CI: 'true' }]) {
      assert.throws(() => T.resolvePayPalTarget({ argv: ['--live', CONFIRM], env: liveEnv, processEnv }), /entorno de pruebas/)
    }
  })
  test('--apply sobre BD de producción exige Live confirmado', () => {
    const env = { PAYPAL_ENV: 'sandbox', NEXT_PUBLIC_SUPABASE_URL: `https://${T.PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` }
    assert.throws(() => T.resolvePayPalTarget({ argv: ['--apply'], env, processEnv: {}, writesSupabase: true }), /base de datos de producción/)
    assert.doesNotThrow(() => T.resolvePayPalTarget({ argv: [], env, processEnv: {}, writesSupabase: true })) // dry-run
    assert.doesNotThrow(() => T.resolvePayPalTarget({ argv: ['--apply'], env: { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, processEnv: {}, writesSupabase: true }))
  })
  test('el ref de producción coincide con el de la app', () => {
    if (RT) assert.equal(T.PRODUCTION_SUPABASE_PROJECT_REF, RT.PRODUCTION_SUPABASE_PROJECT_REF)
  })
})
