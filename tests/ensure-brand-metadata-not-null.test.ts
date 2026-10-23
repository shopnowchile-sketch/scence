import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regresión PROD 2026-10-23: brands.metadata es NOT NULL (default '{}').
// ensureBrandRow insertaba `null` si no había referred_by_instagram y el alta fallaba,
// dejando una organización de marca huérfana. Prueba ESTÁTICA (lee el código fuente).
const src = readFileSync(join(process.cwd(), 'src/lib/supabase/ensureOrg.ts'), 'utf8')

test('ensureBrandRow no asigna null a brands.metadata', () => {
  assert.doesNotMatch(src, /metadata:\s*referredByInstagram\s*\?[^\n]*:\s*null/)
})

test('ensureBrandRow usa objeto vacío como valor alterno', () => {
  assert.match(src, /metadata:\s*referredByInstagram\s*\?\s*\{ referred_by_instagram: referredByInstagram \}\s*:\s*\{\}/)
})

// ── Prueba de COMPORTAMIENTO con Supabase simulado (sin red ni base real) ──────────
// Carga ensureBrandRow del código fuente real, sustituye `./server` por un cliente
// falso que imita la restricción NOT NULL de brands.metadata y registra los inserts.
import { stripTypeScriptTypes } from 'node:module'

type Row = Record<string, unknown>

// En el código consolidado el alta pasa por register_brand (RPC atómica) y ya no hay insert directo.
const HAS_DIRECT_INSERT = /\.from\('brands'\)\s*\.insert\(/.test(src)
const SKIP = HAS_DIRECT_INSERT ? false : 'sin insert directo: el alta usa register_brand (RPC)'

function makeFakeAdmin() {
  const inserts: Row[] = []
  const admin = {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Row | null = null
      const result = () => {
        if (table === 'organization_members' && op === 'select') return { data: { organization_id: 'org-1' }, error: null }
        if (table === 'brands' && op === 'insert') {
          inserts.push(payload as Row)
          // Imita la restricción real: brands.metadata es NOT NULL.
          if ((payload as Row).metadata === null || (payload as Row).metadata === undefined) {
            return { data: null, error: { code: '23502', message: 'null value in column "metadata" violates not-null constraint' } }
          }
          return { data: { id: 'brand-1', name: (payload as Row).name, status: 'pending_approval' }, error: null }
        }
        return { data: null, error: null }
      }
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        ilike: () => q,
        limit: () => q,
        insert: (p: Row) => { op = 'insert'; payload = p; return q },
        update: () => { op = 'update'; return q },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return q
    },
  }
  return { admin, inserts }
}

async function loadEnsureBrandRow(admin: unknown) {
  let js = stripTypeScriptTypes(src)
  js = js.replace(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (line) => {
    const names = /\{([^}]*)\}/.exec(line)![1].split(',').map((s) => s.trim()).filter(Boolean)
    return names.map((n) => `const ${n} = __stubs.${n};`).join('\n')
  })
  js = js.replace(/^import\s.*$/gm, '').replace(/^export\s+type\s.*$/gm, '').replace(/^export\s+/gm, '')
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>
  // Cualquier otra importación (helpers puros) se sustituye por una función identidad.
  const known: Record<string, unknown> = { createAdminClient: () => admin }
  const stubs = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : (x: unknown) => x) })
  const factory = new AsyncFn('__stubs', `${js}\nreturn { ensureBrandRow };`)
  return (await factory(stubs)) as { ensureBrandRow: (u: unknown) => Promise<{ id: string } | null> }
}

test('comportamiento: sin referred_by_instagram el insert envía metadata {} y la marca se crea', { skip: SKIP }, async () => {
  const { admin, inserts } = makeFakeAdmin()
  const { ensureBrandRow } = await loadEnsureBrandRow(admin)
  const brand = await ensureBrandRow({ id: 'u-1', email: 'nueva@marca.cl', user_metadata: { brand_name: 'Marca Nueva' } })
  assert.equal(inserts.length, 1)
  assert.deepEqual(inserts[0].metadata, {})
  assert.equal(brand?.id, 'brand-1')
})

test('comportamiento: con referred_by_instagram el insert conserva la referencia normalizada', { skip: SKIP }, async () => {
  const { admin, inserts } = makeFakeAdmin()
  const { ensureBrandRow } = await loadEnsureBrandRow(admin)
  await ensureBrandRow({ id: 'u-2', email: 'otra@marca.cl', user_metadata: { brand_name: 'Otra', referred_by_instagram: '@Influ.Ejemplo ' } })
  assert.deepEqual(inserts[0].metadata, { referred_by_instagram: 'influ.ejemplo' })
})
