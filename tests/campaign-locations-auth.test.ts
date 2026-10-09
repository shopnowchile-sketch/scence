// Permisos de direcciones de campaña. La service role omite RLS, así que el
// chequeo de CADA handler es la defensa real (CLAUDE.md 16.2): se verifica en el
// código fuente que autoriza antes de tocar datos, que el alcance sale de la
// sesión, y que la base queda cerrada para anon/authenticated.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const { BRAND_PLACE_TYPES, matchesPlaceQuery, normalizeText, validateBrandPlaceCreate, validateBrandPlacePatch } = await import('../src/lib/brand-places.ts')

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const handlers = (source: string) => source.split(/export async function /).slice(1)
const DATA_ACCESS = /admin\s*\.from\(|\.from\('|loadCampaignLocations\(|syncCampaignPrimaryLocation\(/

const CAMPAIGN_ROUTES = [
  'src/app/api/campaigns/[id]/locations/route.ts',
  'src/app/api/campaigns/[id]/locations/[linkId]/route.ts',
]
for (const file of CAMPAIGN_ROUTES) {
  for (const handler of handlers(read(file))) {
    const name = handler.slice(0, handler.indexOf('('))
    test(`${file} ${name}: autoriza (admin o marca dueña) antes de acceder a datos`, () => {
      const authAt = handler.indexOf('authorizeCampaignLocations(')
      const dataAt = handler.search(DATA_ACCESS)
      assert.ok(authAt >= 0, 'debe llamar authorizeCampaignLocations')
      assert.ok(dataAt < 0 || authAt < dataAt, 'la autorización debe preceder a cualquier consulta')
      assert.match(handler, /if \(!access\.ok\) return access\.response/)
    })
    if (name !== 'GET') {
      test(`${file} ${name}: escritura exige campaign.manage`, () => assert.match(handler, /'campaign\.manage'/))
    }
  }
}

test('el vínculo debe pertenecer a la campaña autorizada (no basta con autorizar la campaña)', () => {
  const source = read('src/app/api/campaigns/[id]/locations/[linkId]/route.ts')
  assert.match(source, /\.eq\('id', linkId\)\.eq\('campaign_id', campaignId\)/)
  for (const handler of handlers(source)) assert.match(handler, /findLink\(admin, params\.id, params\.linkId\)/)
})

test('una marca solo asocia lugares propios; uno ajeno responde como inexistente (404)', () => {
  const post = handlers(read('src/app/api/campaigns/[id]/locations/route.ts')).find(h => h.startsWith('POST'))!
  assert.match(post, /if \(brandAccess\)/)
  assert.match(post, /place\.brand_id !== brandAccess\.brandId/)
  assert.match(post, /status: 404/)
})

test('autorización de campaña: reutiliza authorizeCampaignBrandAction y nunca profiles.role', () => {
  const lib = read('src/lib/campaign-locations-auth.ts')
  assert.match(lib, /authorizeCampaignBrandAction\(user\.id, campaignId, permission\)/)
  assert.match(lib, /status: 401/)
  assert.match(lib, /status: 404/)
  assert.doesNotMatch(lib, /profiles[^\n]*role/)
})

for (const [file, perms] of [
  ['src/app/api/brand/locations/route.ts', { GET: 'location.read', POST: 'location.manage' }],
  ['src/app/api/brand/locations/[id]/route.ts', { PATCH: 'location.manage', DELETE: 'location.manage' }],
] as const) {
  for (const handler of handlers(read(file))) {
    const name = handler.slice(0, handler.indexOf('(')) as keyof typeof perms
    test(`${file} ${name}: exige ${perms[name]} antes de acceder a datos`, () => {
      const authAt = handler.indexOf(`authorizeBrandLocations('${perms[name]}')`)
      assert.ok(authAt >= 0, `debe llamar authorizeBrandLocations('${perms[name]}')`)
      const dataAt = handler.search(/admin\s*\.from\(|ownPlaceId\(/)
      assert.ok(dataAt < 0 || authAt < dataAt)
      assert.match(handler, /if \('res' in auth\) return auth\.res/)
    })
  }
}

test('lugares de marca: brand_id y organization_id salen de la sesión, jamás del body', () => {
  const route = read('src/app/api/brand/locations/route.ts')
  assert.match(route, /brand_id: access\.brandId/)
  assert.match(route, /organization_id: access\.organizationId/)
  assert.doesNotMatch(route, /body\??\.(brand_id|organization_id|owner_influencer_id|is_private)/)
})

test('lugares de marca: toda lectura/edición está acotada a la marca de la sesión', () => {
  const list = read('src/app/api/brand/locations/route.ts')
  assert.match(list, /\.eq\('level', 'place'\)\.eq\('brand_id', access\.brandId\)/)
  // la rama geográfica nunca devuelve lugares
  assert.match(list, /\.neq\('level', 'place'\)/)
  const item = read('src/app/api/brand/locations/[id]/route.ts')
  assert.match(item, /\.eq\('brand_id', brandId\)/)
  assert.match(item, /\.eq\('brand_id', access\.brandId\)/)
  assert.doesNotMatch(item, /\.delete\(\)/, 'desactivar, nunca borrar')
})

test('autorización de marca: solo resolveBrandAccess + hasBrandPermission', () => {
  const lib = read('src/lib/brand-locations-auth.ts')
  assert.match(lib, /resolveBrandAccess\(user\.id\)/)
  assert.match(lib, /hasBrandPermission\(access, permission\)/)
  assert.doesNotMatch(lib, /profiles[^\n]*role/)
})

test('marca nunca crea domicilios de influencer; el body no controla marca/organización', () => {
  assert.equal(BRAND_PLACE_TYPES.includes('influencer_home'), false)
  const parsed = validateBrandPlaceCreate({
    name: ' Local Centro ', address: 'Calle 1', parent_id: '6aa1c223-be15-4168-a257-6b67f637a296',
    brand_id: 'otra-marca', organization_id: 'otra-org', is_private: true, owner_influencer_id: 'x',
  })
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(Object.keys(parsed.value).sort(), ['address', 'name', 'notes', 'parent_id', 'type'])
    assert.equal(parsed.value.name, 'Local Centro')
    assert.equal(parsed.value.type, 'brand_venue')
  }
  assert.equal(validateBrandPlaceCreate({ name: 'x', address: 'y', parent_id: '6aa1c223-be15-4168-a257-6b67f637a296', type: 'influencer_home' }).ok, false)
  assert.equal(validateBrandPlaceCreate({ name: '', address: 'y', parent_id: '6aa1c223-be15-4168-a257-6b67f637a296' }).ok, false)
  assert.equal(validateBrandPlaceCreate({ name: 'x', address: '', parent_id: '6aa1c223-be15-4168-a257-6b67f637a296' }).ok, false)
  assert.equal(validateBrandPlaceCreate({ name: 'x', address: 'y', parent_id: 'no-uuid' }).ok, false)
})

test('PATCH de lugar: no permite mover padre/marca/organización', () => {
  const ok = validateBrandPlacePatch({ name: 'Nuevo', brand_id: 'otra', parent_id: '6aa1c223-be15-4168-a257-6b67f637a296', is_active: false })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.deepEqual(Object.keys(ok.value), ['name'])
  assert.equal(validateBrandPlacePatch({ brand_id: 'otra' }).ok, false)
})

test('búsqueda de lugares propios: sin tildes ni mayúsculas', () => {
  assert.equal(normalizeText('  Ñuñoa  CENTRO '), 'nunoa centro')
  assert.equal(matchesPlaceQuery({ name: 'Café Ñuñoa', address: 'Av. Irarrázaval 1' }, 'cafe nunoa'), true)
  assert.equal(matchesPlaceQuery({ name: 'Café Ñuñoa', address: 'Av. Irarrázaval 1' }, 'irarrazaval'), true)
  assert.equal(matchesPlaceQuery({ name: 'Café', address: null }, 'hotel'), false)
})

test('migración: tabla cerrada a anon/authenticated, RLS, índice de una sola principal y RESTRICT', () => {
  const sql = read('supabase/migrations/20261010120000_campaign_locations.sql')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.campaign_locations FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /campaign_id\s+UUID NOT NULL REFERENCES public\.campaigns\(id\) ON DELETE CASCADE/)
  assert.match(sql, /location_id\s+UUID NOT NULL REFERENCES public\.locations\(id\) ON DELETE RESTRICT/)
  assert.match(sql, /UNIQUE INDEX campaign_locations_one_primary_key[\s\S]*WHERE is_primary/)
  assert.match(sql, /UNIQUE INDEX campaign_locations_campaign_location_key/)
  assert.match(sql, /v_loc\.level <> 'place'/)
  assert.match(sql, /influencer_home/)
  assert.match(sql, /pertenece a otra marca/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.campaign_locations_set_primary[\s\S]*GRANT EXECUTE[\s\S]*service_role/)
  assert.doesNotMatch(sql, /ALTER TABLE public\.(campaigns|bookings|locations|brand_locations)/, 'aditiva: no altera tablas existentes')
  assert.doesNotMatch(sql, /DROP |DELETE FROM|UPDATE public\.(?!campaign_locations)/i, 'no migra ni borra datos de otras tablas')
})

test('reversa: elimina solo lo creado por la migración', () => {
  const rollback = read('supabase/rollbacks/20261010120000_campaign_locations_ROLLBACK.sql')
  const code = rollback.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  assert.match(code, /DROP TABLE IF EXISTS public\.campaign_locations/)
  assert.doesNotMatch(code, /public\.(locations|campaigns|bookings)\b/)
})
