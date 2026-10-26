import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findAuthUserByEmail } from '../src/lib/supabase/findAuthUser.ts'

// Fake de admin.auth.admin.listUsers con paginado real (perPage respetado).
function fakeAdmin(total: number, opts: { failOnPage?: number } = {}) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `u${i}`, email: `User${i}@Example.com` }))
  const pages: number[] = []
  const admin = {
    auth: { admin: { listUsers: async ({ page = 1, perPage = 50 } = {}) => {
      pages.push(page)
      if (opts.failOnPage === page) return { data: null, error: new Error('auth down') }
      return { data: { users: all.slice((page - 1) * perPage, page * perPage) }, error: null }
    } } },
  }
  return { admin: admin as never, pages }
}

test('encuentra un usuario fuera de la primera página (caso Catalina, ~2.700 usuarios)', async () => {
  const { admin, pages } = fakeAdmin(2700)
  const u = await findAuthUserByEmail(admin, 'user2650@example.com')
  assert.equal(u?.id, 'u2650')
  assert.deepEqual(pages, [1, 2, 3])
})

test('compara el email sin distinguir mayúsculas ni espacios', async () => {
  const { admin } = fakeAdmin(10)
  assert.equal((await findAuthUserByEmail(admin, '  USER3@example.COM '))?.id, 'u3')
})

test('devuelve null si no existe (y recorre todas las páginas)', async () => {
  const { admin, pages } = fakeAdmin(2100)
  assert.equal(await findAuthUserByEmail(admin, 'nadie@example.com'), null)
  assert.deepEqual(pages, [1, 2, 3])
})

test('falla cerrado: un error de Auth se lanza, no se confunde con "no existe"', async () => {
  const { admin } = fakeAdmin(2500, { failOnPage: 2 })
  await assert.rejects(() => findAuthUserByEmail(admin, 'user2400@example.com'), /auth down/)
})

test('guardia: ninguna ruta usa listUsers() sin paginar ni una sola página para buscar por email', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      const src = readFileSync(p, 'utf8')
      if (/listUsers\(\s*\)/.test(src.replace(/\/\/.*$/gm, ''))) offenders.push(`${p}: listUsers() sin paginar`)
      if (/listUsers\(\{\s*page:\s*1\s*,/.test(src)) offenders.push(`${p}: listUsers({ page: 1 ... }) de una sola página`)
    }
  }
  walk('src')
  assert.deepEqual(offenders, [])
})
