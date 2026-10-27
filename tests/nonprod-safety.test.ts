// Capa A — protecciones de entorno no productivo. Sin red, sin secretos reales.
//   node --test tests/nonprod-safety.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
const RT = await import('../src/lib/runtime-env.ts')
const PP = await import('../src/lib/paypal-env.ts')
const BL = await import('../src/lib/resend-blocked.ts')

const jwt = (ref: string) => `h.${Buffer.from(JSON.stringify({ ref, role: 'x' })).toString('base64url')}.s`
const PROD_REF = RT.PRODUCTION_SUPABASE_PROJECT_REF
const PROD_URL = `https://${PROD_REF}.supabase.co`
const TEST_URL = 'https://abcdefghijklmnopqrst.supabase.co'

const prod = { VERCEL_ENV: 'production', NODE_ENV: 'production' }
const preview = { VERCEL_ENV: 'preview', NODE_ENV: 'production' }
const local = { NODE_ENV: 'development' }
const localWithVercelProd = { VERCEL_ENV: 'production', NODE_ENV: 'development' } // `vercel env pull` + next dev

describe('runtime-env: qué es producción', () => {
  test('solo VERCEL_ENV=production con NODE_ENV != development', () => {
    assert.equal(RT.isProductionRuntime(prod), true)
    assert.equal(RT.isProductionRuntime(preview), false)
    assert.equal(RT.isProductionRuntime(local), false)
    assert.equal(RT.isProductionRuntime(localWithVercelProd), false)
    assert.equal(RT.isProductionRuntime({}), false)
    assert.equal(RT.isProductionRuntime({ VERCEL_ENV: 'Production', NODE_ENV: 'production' }), false)
  })
  test('productionEnv oculta valores fuera de producción', () => {
    assert.equal(RT.productionEnv('X', { ...prod, X: 'v' }), 'v')
    assert.equal(RT.productionEnv('X', { ...preview, X: 'v' }), undefined)
    assert.equal(RT.productionEnv('X', { ...local, X: 'v' }), undefined)
  })
  test('assertProductionRuntime falla explícito fuera de producción y pasa en producción', () => {
    assert.throws(() => RT.assertProductionRuntime('Google Calendar', local), /desactivado fuera de producción/)
    assert.throws(() => RT.assertProductionRuntime('Google Calendar', preview), RT.NonProductionSafetyError)
    assert.doesNotThrow(() => RT.assertProductionRuntime('Google Calendar', prod))
  })
})

describe('T3/T5 base de datos de producción bloqueada fuera de producción', () => {
  const withDb = (env: object, url: string, anon = '', service = '') => ({
    ...env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
  })
  test('localhost y Preview con URL de producción → bloqueado', () => {
    assert.ok(RT.nonProductionDatabaseBlock(withDb(local, PROD_URL)))
    assert.ok(RT.nonProductionDatabaseBlock(withDb(preview, PROD_URL)))
    assert.throws(() => RT.assertDatabaseTargetAllowed(withDb(preview, PROD_URL)), RT.NonProductionSafetyError)
  })
  test('cambiar solo la URL no basta: las claves JWT también delatan producción', () => {
    assert.ok(RT.nonProductionDatabaseBlock(withDb(local, TEST_URL, jwt(PROD_REF))))
    assert.ok(RT.nonProductionDatabaseBlock(withDb(preview, TEST_URL, jwt('otro'), jwt(PROD_REF))))
  })
  test('host con mayúsculas o subdominio engañoso sigue detectándose / no da falso positivo', () => {
    assert.ok(RT.nonProductionDatabaseBlock(withDb(local, `https://${PROD_REF.toUpperCase()}.supabase.co`)))
    assert.equal(RT.nonProductionDatabaseBlock(withDb(local, `https://${PROD_REF}.example.com`)), null)
  })
  test('base de pruebas permitida en local y Preview', () => {
    assert.equal(RT.nonProductionDatabaseBlock(withDb(local, TEST_URL, jwt('abcdefghijklmnopqrst'))), null)
    assert.equal(RT.nonProductionDatabaseBlock(withDb(preview, TEST_URL)), null)
  })
  test('producción nunca se bloquea (conserva su comportamiento)', () => {
    assert.equal(RT.nonProductionDatabaseBlock(withDb(prod, PROD_URL, jwt(PROD_REF), jwt(PROD_REF))), null)
    assert.doesNotThrow(() => RT.assertDatabaseTargetAllowed(withDb(prod, PROD_URL)))
  })
  test('el mensaje no contiene claves', () => {
    const msg = RT.nonProductionDatabaseBlock(withDb(local, PROD_URL, jwt(PROD_REF)))!
    assert.ok(!msg.includes('h.') && !msg.includes('eyJ'))
  })
  test('navegador: bloquea solo compilaciones development/preview con la BD de producción', () => {
    assert.ok(RT.browserDatabaseBlock({ url: PROD_URL, appEnv: 'development' }))
    assert.ok(RT.browserDatabaseBlock({ url: PROD_URL, appEnv: 'preview' }))
    assert.ok(RT.browserDatabaseBlock({ url: TEST_URL, anonKey: jwt(PROD_REF), appEnv: 'preview' }))
    assert.equal(RT.browserDatabaseBlock({ url: PROD_URL, appEnv: 'production' }), null)
    assert.equal(RT.browserDatabaseBlock({ url: PROD_URL, appEnv: undefined }), null)
    assert.equal(RT.browserDatabaseBlock({ url: TEST_URL, appEnv: 'preview' }), null)
  })
})

describe('T2/T5 PayPal: Live solo en producción', () => {
  test('sin PAYPAL_ENV o distinto de live → Sandbox en cualquier entorno', () => {
    for (const base of [prod, preview, local]) {
      assert.equal(PP.payPalBaseUrl({ ...base }), PP.PAYPAL_SANDBOX_BASE_URL)
      assert.equal(PP.payPalBaseUrl({ ...base, PAYPAL_ENV: 'sandbox' }), PP.PAYPAL_SANDBOX_BASE_URL)
      assert.equal(PP.payPalBaseUrl({ ...base, PAYPAL_ENV: 'LIVE' }), PP.PAYPAL_SANDBOX_BASE_URL)
    }
  })
  test('PAYPAL_ENV=live fuera de producción → error explícito (localhost, Preview, vercel env pull)', () => {
    for (const base of [preview, local, localWithVercelProd, {}]) {
      assert.throws(() => PP.payPalBaseUrl({ ...base, PAYPAL_ENV: 'live' }), PP.PayPalEnvironmentError)
      assert.throws(() => PP.resolvePayPalMode({ ...base, PAYPAL_ENV: 'live' }), /fuera de producción/)
    }
  })
  test('producción con PAYPAL_ENV=live conserva Live; sin él, Sandbox (igual que antes)', () => {
    assert.equal(PP.payPalBaseUrl({ ...prod, PAYPAL_ENV: 'live' }), PP.PAYPAL_LIVE_BASE_URL)
    assert.equal(PP.resolvePayPalMode({ ...prod, PAYPAL_ENV: 'live' }), 'live')
  })
  test('lee process.env cuando no se inyecta entorno y no llama a la red', () => {
    const saved = { ...process.env }
    try {
      delete process.env.VERCEL_ENV
      process.env.PAYPAL_ENV = 'live'
      const realFetch = globalThis.fetch
      let calls = 0
      globalThis.fetch = (async () => { calls++; throw new Error('red prohibida en tests') }) as typeof fetch
      try { assert.throws(() => PP.payPalBaseUrl(), PP.PayPalEnvironmentError) } finally { globalThis.fetch = realFetch }
      assert.equal(calls, 0)
    } finally {
      for (const k of ['VERCEL_ENV', 'PAYPAL_ENV']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    }
  })
})

describe('T4 Resend: sumidero fuera de producción', () => {
  test('emails.send y batch.send simulan éxito, no usan red y no registran destinatarios', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls++; throw new Error('red prohibida') }) as typeof fetch
    const logs: string[] = []
    try {
      const client = BL.createBlockedResend((m: string) => logs.push(m)) as any
      const one = await client.emails.send({ to: 'persona@ejemplo.cl', subject: 'Secreto', html: '<b>x</b>' })
      assert.equal(one.error, null)
      assert.match(one.data.id, /^blocked-non-production-/)
      const many = await client.batch.send([{ to: 'a@x.cl' }, { to: 'b@x.cl' }])
      assert.equal(many.data.data.length, 2)
    } finally { globalThis.fetch = realFetch }
    assert.equal(calls, 0)
    assert.equal(logs.length, 2)
    assert.ok(logs.every(l => !l.includes('@') && !l.includes('Secreto')))
  })
  test('cualquier otro método de Resend falla cerrado', () => {
    const client = BL.createBlockedResend(() => {}) as any
    assert.throws(() => client.contacts, RT.NonProductionSafetyError)
    assert.throws(() => client.apiKeys, /no está disponible fuera de producción/)
  })
})
