// Marcas colaboradoras comerciales: datos internos, solo admin de plataforma.
// Garantiza que TODO handler de las rutas valida identidad y rol en el servidor
// antes de tocar la base (la service role omite RLS, así que el chequeo de la ruta es la defensa).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROUTES = [
  'src/app/api/campaigns/[id]/collaborations/route.ts',
  'src/app/api/campaigns/[id]/collaborations/candidates/route.ts',
  'src/app/api/campaigns/[id]/collaborations/[cid]/route.ts',
  'src/app/api/campaigns/[id]/collaborations/plans/route.ts',
  'src/app/api/campaigns/[id]/collaborations/plans/[planId]/route.ts',
]

for (const file of ROUTES) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const handlers = source.split(/export async function /).slice(1)

  test(`${file}: expone handlers`, () => assert.ok(handlers.length > 0))

  for (const handler of handlers) {
    const name = handler.slice(0, handler.indexOf('('))
    test(`${file} ${name}: autoriza antes de acceder a datos`, () => {
      const authAt = handler.indexOf('authorizeCollaborationAdmin(params.id)')
      const dataAt = handler.search(/admin\s*\.from\(|auth\.admin\s*\.from\(|\.from\('/)
      assert.ok(authAt >= 0, 'debe llamar authorizeCollaborationAdmin')
      assert.ok(dataAt < 0 || authAt < dataAt, 'la autorización debe preceder a cualquier consulta')
      assert.match(handler, /if \(!auth\.ok\) return auth\.response/)
    })
  }
}

test('authorizeCollaborationAdmin: 401 sin sesión, 403 sin rol admin de plataforma, 404 sin campaña', () => {
  const lib = readFileSync(new URL('../src/lib/campaign-collaborations.ts', import.meta.url), 'utf8')
  assert.match(lib, /status: 401/)
  assert.match(lib, /isPlatformAdmin\(user\.id, admin\)/)
  assert.match(lib, /status: 403/)
  assert.match(lib, /status: 404/)
  assert.doesNotMatch(lib, /profiles[^\n]*role/, 'nunca autorizar con profiles.role (CLAUDE.md 16.2)')
})

test('la pestaña no se muestra en el portal de marca', () => {
  const detail = readFileSync(new URL('../src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx', import.meta.url), 'utf8')
  assert.match(detail, /tab === 'collaborators' && !isBrandPortal/)
})
