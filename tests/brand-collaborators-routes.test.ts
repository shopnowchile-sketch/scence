// M5 — Ejecuta los handlers REALES de /api/brand/collaborators (GET/POST/DELETE)
// contra una base EN MEMORIA con datos ficticios (tests/support/memory-supabase.ts).
// Sin .env, sin red, sin Supabase, sin PostgreSQL.
//
// ESTAS PRUEBAS SON SIMULADAS, NO SON INTEGRACIÓN REAL. La base en memoria no valida
// restricciones: SOLO la unicidad (23505) y el CHECK de autorelación (23514) se emulan
// aquí con un envoltorio local (`withPgConstraints`) que imita el contrato de la migración
// 20261023120000. NO se prueba: RLS, privilegios (REVOKE), claves foráneas, el CASCADE real
// (solo se simula una fila huérfana en GET), índices ni concurrencia real de PostgreSQL
// → requieren una base aislada (pendiente).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const route = await import('../src/app/api/brand/collaborators/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>
type PgError = { code?: string; message: string }

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F1 = U(6), F2 = U(7), G = U(8)
const GHOST = U(99)

function freshDb(): Db {
  const brand = (id: string, name: string, status: string, ig: string | null): Row => ({
    id, name, status, logo_url: `https://logo.test/${name}.png`, instagram: ig ? `@${ig}` : null,
    instagram_handle_normalized: ig, organization_id: `org-${name}`, contact_email: `${name}@privado.test`,
    user_id: `owner-of-${name}`, metadata: { secreto: name }, website: `https://${name}.test`,
  })
  return {
    brands: [
      brand(A, 'marca_a', 'approved', 'marca_a'),
      brand(B, 'marca_b', 'approved', 'marca_b'),
      brand(C, 'marca_c', 'pending_approval', 'marca_c'),
      brand(D, 'marca_d', 'rejected', 'marca_d'),
      brand(E, 'marca_e', 'suspended', 'marca_e'),
      brand(F1, 'marca_f1', 'approved', 'dup_f'),
      brand(F2, 'marca_f2', 'approved', 'dup_f'), // dos marcas aprobadas con el mismo Instagram
      brand(G, 'marca_g', 'approved', null),
    ],
    organization_members: [
      { id: 'm1', user_id: 'u-admin', organization_id: 'org-agency', role: 'super_admin', is_active: true, brand_id: null, is_owner: true },
      { id: 'm2', user_id: 'u-A-owner', organization_id: 'org-marca_a', role: 'brand_manager', is_active: true, brand_id: A, is_owner: true },
      { id: 'm3', user_id: 'u-A-member', organization_id: 'org-marca_a', role: 'member', is_active: true, brand_id: A, is_owner: false },
      { id: 'm4', user_id: 'u-A-manager', organization_id: 'org-marca_a', role: 'brand_manager', is_active: true, brand_id: A, is_owner: false },
      { id: 'm5', user_id: 'u-A-finance', organization_id: 'org-marca_a', role: 'finance', is_active: true, brand_id: A, is_owner: false },
      { id: 'm6', user_id: 'u-B-owner', organization_id: 'org-marca_b', role: 'brand_manager', is_active: true, brand_id: B, is_owner: true },
      { id: 'm7', user_id: 'u-C-owner', organization_id: 'org-marca_c', role: 'brand_manager', is_active: true, brand_id: C, is_owner: true }, // marca NO aprobada
    ],
    campaigns: [{ id: 'camp-A', organization_id: 'org-agency', brand_id: A }],
    campaign_brands: [],
    brand_collaborators: [
      { id: 'r1', brand_id: A, collaborator_brand_id: B, created_by: 'u-A-owner', created_at: '2026-10-01T00:00:00Z' },
      { id: 'r2', brand_id: A, collaborator_brand_id: F1, created_by: 'u-A-owner', created_at: '2026-10-01T00:00:00Z' },
      { id: 'r3', brand_id: B, collaborator_brand_id: G, created_by: 'u-B-owner', created_at: '2026-10-01T00:00:00Z' }, // ajena a A
      { id: 'r4', brand_id: C, collaborator_brand_id: B, created_by: 'u-C-owner', created_at: '2026-10-01T00:00:00Z' }, // ajena a A (mismo destino B)
    ],
  }
}

const snapshot = (db: Db) => JSON.parse(JSON.stringify(db))
const rels = (db: Db) => (db.brand_collaborators ?? []).map(r => `${r.brand_id}>${r.collaborator_brand_id}`).sort()
const without = (db: Db, table: string) => { const s = snapshot(db); delete s[table]; return s }

/** Emula el contrato de la migración: UNIQUE(brand_id, collaborator_brand_id) y CHECK(brand_id <> collaborator_brand_id).
 *  El INSERT se ejecuta de forma síncrona (atómico), como una sentencia de Postgres. NO es PostgreSQL. */
function withPgConstraints(db: Db, opts: { insertError?: PgError; fail?: Record<string, string>; failCollaboratorBrandsRead?: boolean } = {}) {
  const base = makeAdmin(db, { autoId: true, projectColumns: true, ...(opts.fail ?? {}) })
  return {
    from(table: string) {
      const b = base.from(table)
      if (table === 'brands' && opts.failCollaboratorBrandsRead) {
        // Falla SOLO la lectura de campos públicos (no la autorización, que lee id/organization_id/status).
        const select = b.select.bind(b)
        b.select = (cols?: string, o?: unknown) => {
          if (cols !== 'id, name, logo_url, instagram') return select(cols, o)
          const failing: any = { eq: () => failing, in: () => failing, limit: () => failing, then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'lectura fallida' } }) }
          return failing
        }
        return b
      }
      if (table !== 'brand_collaborators') return b
      const insert = b.insert.bind(b)
      b.insert = (payload: Row) => {
        if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError })
        const rows = (db.brand_collaborators ??= [])
        if (payload.brand_id === payload.collaborator_brand_id) {
          return Promise.resolve({ data: null, error: { code: '23514', message: 'new row violates check constraint "brand_collaborators_not_self"' } })
        }
        if (rows.some(r => r.brand_id === payload.brand_id && r.collaborator_brand_id === payload.collaborator_brand_id)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brand_collaborators_pair_key"' } })
        }
        let out: unknown
        insert(payload).then((v: unknown) => { out = v }) // el builder resuelve de forma síncrona
        return Promise.resolve(out)
      }
      return b
    },
  } as any
}

type CallOpts = { user: string | null; db: Db; query?: string; body?: unknown; badJson?: boolean; insertError?: PgError; fail?: Record<string, string>; failCollaboratorBrandsRead?: boolean }
async function call(handler: 'GET' | 'POST' | 'DELETE', o: CallOpts) {
  ;(globalThis as any).__routeHarness = {
    user: o.user ? { id: o.user } : null,
    admin: withPgConstraints(o.db, { insertError: o.insertError, fail: o.fail, failCollaboratorBrandsRead: o.failCollaboratorBrandsRead }),
  }
  const url = `http://localhost/api/brand/collaborators${o.query ?? ''}`
  const req = {
    url,
    nextUrl: new URL(url),
    json: async () => { if (o.badJson) throw new SyntaxError('bad json'); return o.body },
  } as any
  const res = await route[handler](req)
  return { status: res.status as number, json: (await res.json()) as any }
}

const PUBLIC_KEYS = ['id', 'instagram', 'logo_url', 'name']
const listedIds = (r: { json: any }) => (r.json.data as Row[]).map(x => x.brand.id).sort()

// ── GET ──────────────────────────────────────────────────────────────────

test('GET: todos los roles autorizados de la marca A consultan SU lista (y solo la suya)', async () => {
  for (const user of ['u-A-owner', 'u-A-member', 'u-A-manager']) {
    const r = await call('GET', { user, db: freshDb() })
    assert.equal(r.status, 200, user)
    assert.deepEqual(listedIds(r), [B, F1].sort(), `${user}: no incluye r3 (B→G) ni r4 (C→B)`)
  }
  // 'finance' ya no es un rol de marca (owner/member): no concede acceso.
  assert.equal((await call('GET', { user: 'u-A-finance', db: freshDb() })).status, 403, 'u-A-finance')
})

test('GET: solo expone id, nombre, logo e Instagram; nunca estado ni datos privados', async () => {
  const r = await call('GET', { user: 'u-A-owner', db: freshDb() })
  for (const item of r.json.data as Row[]) {
    assert.deepEqual(Object.keys(item.brand).sort(), PUBLIC_KEYS)
    assert.deepEqual(Object.keys(item).sort(), ['added_at', 'brand'])
  }
  const text = JSON.stringify(r.json)
  for (const secret of ['status', 'approved', 'privado.test', 'secreto', 'organization_id', 'user_id', 'website']) {
    assert.ok(!text.includes(secret), `no debe filtrar «${secret}»`)
  }
})

test('GET: la relación es direccional (A→B no hace que B vea a A)', async () => {
  const r = await call('GET', { user: 'u-B-owner', db: freshDb() })
  assert.deepEqual(listedIds(r), [G])
})

test('GET: sin sesión 401; sin marca 403; marca NO aprobada 403', async () => {
  assert.equal((await call('GET', { user: null, db: freshDb() })).status, 401)
  assert.equal((await call('GET', { user: 'u-stranger', db: freshDb() })).status, 403)
  assert.equal((await call('GET', { user: 'u-C-owner', db: freshDb() })).status, 403)
})

test('GET: un brand_id ajeno (marca B, C o inexistente) → 403; el propio → 200; inválido → 422', async () => {
  for (const other of [B, C, GHOST]) {
    assert.equal((await call('GET', { user: 'u-A-owner', db: freshDb(), query: `?brand_id=${other}` })).status, 403, other)
  }
  assert.equal((await call('GET', { user: 'u-A-owner', db: freshDb(), query: `?brand_id=${A}` })).status, 200)
  assert.equal((await call('GET', { user: 'u-A-owner', db: freshDb(), query: '?brand_id=no-es-uuid' })).status, 422)
})

test('GET: super_admin debe indicar la marca; ve la lista de cualquiera; marca inexistente 404', async () => {
  assert.equal((await call('GET', { user: 'u-admin', db: freshDb() })).status, 422)
  assert.deepEqual(listedIds(await call('GET', { user: 'u-admin', db: freshDb(), query: `?brand_id=${B}` })), [G])
  assert.deepEqual(listedIds(await call('GET', { user: 'u-admin', db: freshDb(), query: `?brand_id=${C}` })), [B])
  assert.equal((await call('GET', { user: 'u-admin', db: freshDb(), query: `?brand_id=${GHOST}` })).status, 404)
})

test('GET: lista vacía → []; fila huérfana (marca borrada) se omite; errores de lectura → 500', async () => {
  const empty = freshDb(); empty.brand_collaborators = []
  assert.deepEqual((await call('GET', { user: 'u-A-owner', db: empty })).json, { data: [] })
  const orphan = freshDb(); orphan.brand_collaborators.push({ id: 'r9', brand_id: A, collaborator_brand_id: GHOST })
  assert.deepEqual(listedIds(await call('GET', { user: 'u-A-owner', db: orphan })), [B, F1].sort())
  assert.equal((await call('GET', { user: 'u-A-owner', db: freshDb(), fail: { failSelectOn: 'brand_collaborators' } })).status, 500)
  assert.equal((await call('GET', { user: 'u-A-owner', db: freshDb(), failCollaboratorBrandsRead: true })).status, 500)
})

// ── POST ─────────────────────────────────────────────────────────────────

test('POST: el owner agrega una marca aprobada existente; reutiliza su brand_id y registra quién la agregó', async () => {
  const db = freshDb(); db.brand_collaborators = []
  const r = await call('POST', { user: 'u-A-owner', db, body: { instagram: '@Marca_B' } })
  assert.equal(r.status, 201)
  assert.equal(r.json.created, true)
  assert.equal(r.json.data.brand.id, B, 'reutiliza el brand_id existente')
  assert.deepEqual(Object.keys(r.json.data.brand).sort(), PUBLIC_KEYS, 'sin estado ni datos privados')
  assert.deepEqual(db.brand_collaborators, [{ brand_id: A, collaborator_brand_id: B, created_by: 'u-A-owner', id: 'mem-1' }])
  assert.equal(db.brands.length, 8, 'no se crea ninguna marca')
})

test('POST: variantes del mismo Instagram resuelven a la misma marca sin duplicar la relación', async () => {
  const db = freshDb(); db.brand_collaborators = []
  const variants = ['@marca_b', 'MARCA_B', ' @Marca_B ', 'https://www.instagram.com/marca_b/', 'https://instagram.com/Marca_B?hl=es']
  const results = []
  for (const instagram of variants) results.push(await call('POST', { user: 'u-A-owner', db, body: { instagram } }))
  assert.deepEqual(results.map(r => r.status), [201, 200, 200, 200, 200])
  assert.ok(results.every(r => r.json.data.brand.id === B))
  assert.deepEqual(rels(db), [`${A}>${B}`])
})

test('POST: idempotente — repetir devuelve 200 created:false y no cambia nada', async () => {
  const db = freshDb()
  const before = snapshot(db)
  const r = await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b' } }) // A→B ya existe (r1)
  assert.equal(r.status, 200)
  assert.equal(r.json.created, false)
  assert.deepEqual(db, before)
})

test('POST: solicitudes SIMULTÁNEAS (simuladas) dejan una sola relación', async () => {
  const db = freshDb(); db.brand_collaborators = []
  // Un único harness compartido: se lanzan en paralelo sobre la misma base en memoria.
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', { user: 'u-A-owner', db, body: { instagram: '@marca_b' } })))
  assert.equal(rs.filter(r => r.status === 201).length, 1)
  assert.equal(rs.filter(r => r.status === 200).length, 5)
  assert.deepEqual(rels(db), [`${A}>${B}`])
})

test('POST: la relación es direccional y no concede nada (ni inversa, ni campañas, ni membresías)', async () => {
  const db = freshDb(); db.brand_collaborators = []
  const before = without(db, 'brand_collaborators')
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b' } })).status, 201)
  assert.deepEqual(rels(db), [`${A}>${B}`], 'sin fila inversa B→A')
  assert.deepEqual(without(db, 'brand_collaborators'), before, 'organization_members, campaigns, campaign_brands y brands intactos')
  assert.deepEqual(listedIds(await call('GET', { user: 'u-B-owner', db })), [], 'B no ve a A')
})

test('POST: solo el owner agrega; member, brand_manager y finance reciben 403 y no escriben', async () => {
  for (const user of ['u-A-member', 'u-A-manager', 'u-A-finance']) {
    const db = freshDb(); const before = snapshot(db)
    assert.equal((await call('POST', { user, db, body: { instagram: 'marca_b' } })).status, 403, user)
    assert.deepEqual(db, before, user)
  }
})

test('POST: marca no aprobada, sin marca o sin sesión → 403/403/401 y sin escritura', async () => {
  const db = freshDb(); const before = snapshot(db)
  assert.equal((await call('POST', { user: 'u-C-owner', db, body: { instagram: 'marca_b' } })).status, 403)
  assert.equal((await call('POST', { user: 'u-stranger', db, body: { instagram: 'marca_b' } })).status, 403)
  assert.equal((await call('POST', { user: null, db, body: { instagram: 'marca_b' } })).status, 401)
  assert.deepEqual(db, before)
})

test('POST: aislamiento — un brand_id ajeno en el body se rechaza (403) y el propio se acepta', async () => {
  const db = freshDb(); const before = snapshot(db)
  for (const other of [B, C, GHOST]) {
    assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_g', brand_id: other } })).status, 403, other)
  }
  assert.deepEqual(db, before)
  db.brand_collaborators = []
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b', brand_id: A } })).status, 201)
  assert.deepEqual(rels(db), [`${A}>${B}`])
})

test('POST: marca inexistente, pendiente, rechazada o suspendida → MISMA respuesta 404, sin revelar estado ni crear nada', async () => {
  const outcomes = []
  for (const ig of ['marca_inexistente', 'marca_c', 'marca_d', 'marca_e']) {
    const db = freshDb(); const before = snapshot(db)
    const r = await call('POST', { user: 'u-A-owner', db, body: { instagram: ig } })
    assert.equal(r.status, 404, ig)
    assert.equal(r.json.code, 'brand_not_found_creation_disabled', ig)
    assert.deepEqual(db, before, `${ig}: sin escrituras ni marcas nuevas`)
    outcomes.push(JSON.stringify(r.json))
  }
  assert.equal(new Set(outcomes).size, 1, 'las cuatro respuestas son idénticas byte a byte')
  for (const leak of ['pending', 'rejected', 'suspended', 'approved', 'marca_c', 'marca_d', 'marca_e']) {
    assert.ok(!outcomes[0].includes(leak), `no debe mencionar «${leak}»`)
  }
})

test('POST: varias marcas aprobadas con el mismo Instagram → 409, no se elige ni se fusiona', async () => {
  const db = freshDb(); const before = snapshot(db)
  const r = await call('POST', { user: 'u-A-owner', db, body: { instagram: 'dup_f' } })
  assert.equal(r.status, 409)
  assert.equal(r.json.code, 'ambiguous_instagram')
  assert.deepEqual(db, before)
})

test('POST: una marca no puede agregarse a sí misma (422, sin escritura)', async () => {
  const db = freshDb(); const before = snapshot(db)
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: '@marca_a' } })).status, 422)
  assert.deepEqual(db, before)
})

test('POST: Instagram vacío/ inválido/ ajeno a Instagram → 422; JSON inválido → 400; marca sin Instagram no se adivina', async () => {
  for (const instagram of [undefined, '', '   ', 'a b', 'x'.repeat(31), 'https://evil.com/marca_b', null]) {
    const db = freshDb(); const before = snapshot(db)
    assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram } })).status, 422, String(instagram))
    assert.deepEqual(db, before)
  }
  assert.equal((await call('POST', { user: 'u-A-owner', db: freshDb(), badJson: true })).status, 400)
  const db = freshDb(); const before = snapshot(db)
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_g_sin_ig' } })).status, 404)
  assert.deepEqual(db, before)
})

test('POST: cuerpo JSON `null` → 400 (sin excepción, sin 500, sin escritura), con o sin sesión', async () => {
  for (const user of ['u-A-owner', 'u-admin', 'u-A-member', null]) {
    const db = freshDb(); const before = snapshot(db)
    const r = await call('POST', { user, db, body: null })
    assert.deepEqual(r, { status: 400, json: { error: 'Invalid JSON' } }, String(user))
    assert.deepEqual(db, before, String(user))
  }
})

test('POST: super_admin agrega indicando la marca; sin brand_id 422; marca inexistente 404', async () => {
  const db = freshDb(); db.brand_collaborators = []
  assert.equal((await call('POST', { user: 'u-admin', db, body: { instagram: 'marca_b' } })).status, 422)
  assert.equal((await call('POST', { user: 'u-admin', db, body: { instagram: 'marca_b', brand_id: GHOST } })).status, 404)
  const r = await call('POST', { user: 'u-admin', db, body: { instagram: 'marca_b', brand_id: A } })
  assert.equal(r.status, 201)
  assert.deepEqual(db.brand_collaborators.map(x => [x.brand_id, x.collaborator_brand_id, x.created_by]), [[A, B, 'u-admin']])
})

test('POST: 23505 se trata como «ya existía» (200) pero NINGÚN otro error se silencia', async () => {
  // 23505 simulado aunque la fila no exista: confirma la rama de idempotencia.
  const dup = freshDb(); dup.brand_collaborators = []
  const r = await call('POST', { user: 'u-A-owner', db: dup, body: { instagram: 'marca_b' }, insertError: { code: '23505', message: 'duplicate key' } })
  assert.equal(r.status, 200); assert.equal(r.json.created, false)

  const unexpected: PgError[] = [
    { code: '23503', message: 'insert violates foreign key constraint "brand_collaborators_collaborator_brand_id_fkey"' },
    { code: '23514', message: 'violates check constraint' },
    { code: '42501', message: 'permission denied for table brand_collaborators' },
    { code: '40001', message: 'could not serialize access' },
    { message: 'error sin código' },
  ]
  for (const insertError of unexpected) {
    const db = freshDb(); db.brand_collaborators = []
    const res = await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b' }, insertError })
    assert.equal(res.status, 500, insertError.code ?? 'sin código')
    assert.notEqual(res.json.created, false)
    assert.deepEqual(db.brand_collaborators, [], 'no queda ninguna fila')
  }
})

test('POST: error de lectura al buscar la marca → 500 y sin escritura', async () => {
  const db = freshDb(); const before = snapshot(db)
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b' }, failCollaboratorBrandsRead: true })).status, 500)
  assert.deepEqual(db, before)
  // Si falla TODA lectura de brands, la autorización falla cerrado (403) antes de buscar nada.
  assert.equal((await call('POST', { user: 'u-A-owner', db, body: { instagram: 'marca_b' }, fail: { failSelectOn: 'brands' } })).status, 403)
  assert.deepEqual(db, before)
})

// ── DELETE ───────────────────────────────────────────────────────────────

test('DELETE: el owner quita SOLO su relación A→B; las demás (incluida C→B, mismo destino) quedan intactas', async () => {
  const db = freshDb()
  const r = await call('DELETE', { user: 'u-A-owner', db, query: `?collaborator_brand_id=${B}` })
  assert.deepEqual(r, { status: 200, json: { success: true } })
  assert.deepEqual(rels(db), [`${A}>${F1}`, `${B}>${G}`, `${C}>${B}`].sort())
})

test('DELETE: aislamiento — A no puede borrar relaciones de otra marca ni indicando su brand_id', async () => {
  const onlyOthers = freshDb(); onlyOthers.brand_collaborators = onlyOthers.brand_collaborators.filter(r => r.brand_id !== A)
  const before = snapshot(onlyOthers)
  // A pide quitar G (relación B→G) y B (relación C→B): ninguna es de A → no borra nada.
  for (const target of [G, B]) {
    const r = await call('DELETE', { user: 'u-A-owner', db: onlyOthers, query: `?collaborator_brand_id=${target}` })
    assert.equal(r.status, 200, 'idempotente: no revela si existía')
    assert.deepEqual(onlyOthers, before)
  }
  // Apuntar a otra marca por brand_id → 403 sin tocar nada.
  for (const other of [B, C, GHOST]) {
    const db = freshDb(); const snap = snapshot(db)
    assert.equal((await call('DELETE', { user: 'u-A-owner', db, query: `?collaborator_brand_id=${G}&brand_id=${other}` })).status, 403, other)
    assert.deepEqual(db, snap)
  }
})

test('DELETE: idempotente — repetir no falla ni borra nada más', async () => {
  const db = freshDb()
  await call('DELETE', { user: 'u-A-owner', db, query: `?collaborator_brand_id=${B}` })
  const after = snapshot(db)
  const again = await call('DELETE', { user: 'u-A-owner', db, query: `?collaborator_brand_id=${B}` })
  assert.deepEqual(again, { status: 200, json: { success: true } })
  assert.deepEqual(db, after)
})

test('DELETE: member, brand_manager, finance, marca no aprobada, extraño y sin sesión no borran', async () => {
  const expected: Array<[string | null, number]> = [
    ['u-A-member', 403], ['u-A-manager', 403], ['u-A-finance', 403], ['u-C-owner', 403], ['u-stranger', 403], [null, 401],
  ]
  for (const [user, status] of expected) {
    const db = freshDb(); const before = snapshot(db)
    assert.equal((await call('DELETE', { user, db, query: `?collaborator_brand_id=${B}` })).status, status, String(user))
    assert.deepEqual(db, before, String(user))
  }
})

test('DELETE: collaborator_brand_id ausente o inválido y brand_id inválido → 422 sin borrar', async () => {
  for (const query of ['', '?collaborator_brand_id=', '?collaborator_brand_id=x', `?collaborator_brand_id=${B}&brand_id=zzz`]) {
    const db = freshDb(); const before = snapshot(db)
    assert.equal((await call('DELETE', { user: 'u-A-owner', db, query })).status, 422, query)
    assert.deepEqual(db, before)
  }
})

test('DELETE: super_admin debe indicar la marca y solo borra la relación de esa marca', async () => {
  const db = freshDb()
  assert.equal((await call('DELETE', { user: 'u-admin', db, query: `?collaborator_brand_id=${B}` })).status, 422)
  assert.equal((await call('DELETE', { user: 'u-admin', db, query: `?collaborator_brand_id=${B}&brand_id=${GHOST}` })).status, 404)
  assert.equal(rels(db).length, 4)
  assert.equal((await call('DELETE', { user: 'u-admin', db, query: `?collaborator_brand_id=${B}&brand_id=${C}` })).status, 200)
  assert.deepEqual(rels(db), [`${A}>${B}`, `${A}>${F1}`, `${B}>${G}`].sort(), 'solo C→B desaparece')
})

test('DELETE: error al borrar → 500 y la relación sigue intacta', async () => {
  const db = freshDb(); const before = snapshot(db)
  assert.equal((await call('DELETE', { user: 'u-A-owner', db, query: `?collaborator_brand_id=${B}`, fail: { failDeleteOn: 'brand_collaborators' } })).status, 500)
  assert.deepEqual(db, before)
})
