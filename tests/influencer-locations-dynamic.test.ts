import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/app/api/influencer/locations/route.ts', import.meta.url), 'utf8')

test('locations es una Route Handler dinámica y no se ejecuta durante el prerender', () => {
  assert.match(route, /export const dynamic = 'force-dynamic'/)
  assert.match(route, /export async function GET\(req: NextRequest\)/)
  assert.match(route, /createAdminClient\(\)/)
})
