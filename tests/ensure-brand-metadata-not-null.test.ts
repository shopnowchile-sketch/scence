// Regresión de metadata NOT NULL: ejecuta ensureBrandRow y registerBrandAtomic reales.
// Reutiliza el arnés existente; RPC y Auth simuladas, sin red ni datos reales.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')
const { ensureBrandRow } = await import('../src/lib/supabase/ensureOrg.ts')

for (const [label, referral, expected] of [
  ['sin referido', undefined, {}],
  ['referido normalizado', '@Influ.Ejemplo ', { referred_by_instagram: 'influ.ejemplo' }],
] as const) {
  test(`ensureBrandRow: ${label} conserva metadata no nula en register_brand`, async () => {
    const calls: Record<string, any>[] = []
    const admin = {
      ...makeAdmin({ brands: [], profiles: [], influencer_social_profiles: [] }),
      rpc: async (name: string, args: Record<string, any>) => {
        assert.equal(name, 'register_brand')
        calls.push(args)
        assert.notEqual(args.p_brand.metadata, null)
        return { data: [{ out_brand_id: 'brand-1', out_organization_id: 'org-1', out_outcome: 'created' }], error: null }
      },
      auth: { admin: { updateUserById: async () => ({ error: null }) } },
    }
    ;(globalThis as any).__routeHarness = { user: { id: 'u-1' }, admin }
    try {
      const brand = await ensureBrandRow({ id: 'u-1', email: 'test@example.invalid', user_metadata: { brand_name: 'Prueba', referred_by_instagram: referral } } as any)
      assert.equal(calls.length, 1)
      assert.deepEqual(calls[0].p_brand.metadata, expected)
      assert.equal(calls[0].p_owner_user_id, 'u-1')
      assert.equal(calls[0].p_idempotency_key, 'self:u-1')
      assert.deepEqual(brand, { id: 'brand-1', name: 'Prueba', status: 'pending_approval' })
    } finally {
      delete (globalThis as any).__routeHarness
    }
  })
}
