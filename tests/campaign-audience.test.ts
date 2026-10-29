// Segmentación geográfica de campañas: regla de coincidencia (regresión: sin zonas = visible para todas),
// seguridad (cada punto de entrada de la influencer y cada handler de gestión) y aislamiento de la
// dirección del evento. La service role omite RLS: el chequeo de cada ruta es la defensa real.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const { locationLineage, matchesAudience } = await import('../src/lib/campaign-audience.ts')
const { latamCountryIds } = await import('../src/lib/campaign-audience-latam.ts')

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const nodes = [
  { id: 'cl', parent_id: null },
  { id: 'rm', parent_id: 'cl' },
  { id: 'lascondes', parent_id: 'rm' },
  { id: 'nunoa', parent_id: 'rm' },
  { id: 'valpo', parent_id: 'cl' },
  { id: 'vina', parent_id: 'valpo' },
  { id: 'ar', parent_id: null },
  { id: 'caba', parent_id: 'ar' },
]
const lineage = (id: string | null) => locationLineage(id, nodes)

test('regresión: campaña sin zonas es visible para todas, incluso sin ubicación', () => {
  assert.equal(matchesAudience(undefined, lineage('vina')), true)
  assert.equal(matchesAudience([], lineage(null)), true)
})

test('comuna: solo coincide la comuna elegida', () => {
  assert.equal(matchesAudience(['lascondes', 'nunoa'], lineage('nunoa')), true)
  assert.equal(matchesAudience(['lascondes'], lineage('nunoa')), false)
})

test('región completa: cubre sus comunas y no las de otra región', () => {
  assert.equal(matchesAudience(['rm'], lineage('lascondes')), true)
  assert.equal(matchesAudience(['rm'], lineage('vina')), false)
})

test('país completo: cubre todo el país y nada de otro', () => {
  assert.equal(matchesAudience(['cl'], lineage('vina')), true)
  assert.equal(matchesAudience(['cl'], lineage('caba')), false)
})

test('una zona más específica que la ubicación de la influencer no coincide', () => {
  // Influencer registrada solo a nivel país no puede afirmarse "de Las Condes".
  assert.equal(matchesAudience(['lascondes'], lineage('cl')), false)
})

test('seguridad: influencer sin ubicación no ve campañas segmentadas (falla cerrado)', () => {
  assert.equal(matchesAudience(['cl'], lineage(null)), false)
  assert.equal(matchesAudience(['cl'], lineage('no-existe')), false)
})

test('LATAM se expande a los países LATAM del catálogo, ignorando tildes y no-LATAM', () => {
  const ids = latamCountryIds([
    { id: '1', level: 'country', name: 'Perú' }, { id: '2', level: 'country', name: 'peru' },
    { id: '3', level: 'country', name: 'España' }, { id: '4', level: 'country', name: 'Estados Unidos' },
    { id: '5', level: 'region', name: 'Chile' }, { id: '6', level: 'country', name: 'México', is_active: false },
  ])
  assert.deepEqual(ids.sort(), ['1', '2'])
})

for (const file of [
  'src/app/api/influencer/campaigns/open/route.ts',
  'src/app/api/influencer/campaigns/[id]/route.ts',
  'src/app/api/influencer/campaigns/[id]/apply/route.ts',
  'src/lib/campaign-notifications.ts',
]) {
  test(`${file}: aplica la segmentación geográfica`, () => assert.match(read(file), /audienceMatcherFor\(/))
}

test('detalle y postulación: sin acceso devuelve 404 y un error al leer segmentación falla cerrado', () => {
  const detail = read('src/app/api/influencer/campaigns/[id]/route.ts')
  assert.match(detail, /catch \{\s*return NextResponse\.json\(\{ error: 'Campaña no encontrada' \}, \{ status: 404 \}\)/)
  const apply = read('src/app/api/influencer/campaigns/[id]/apply/route.ts')
  assert.match(apply, /catch \{ allowed = false \}/)
  assert.match(apply, /if \(!allowed\) return NextResponse\.json\(\{ error: 'Campaña no encontrada' \}, \{ status: 404 \}\)/)
})

test('permisos vigentes: quien ya tiene postulación/invitación no pierde acceso por la segmentación', () => {
  assert.match(read('src/app/api/influencer/campaigns/[id]/route.ts'), /if \(!existing\) \{\s*try \{\s*const audience/)
  assert.match(read('src/app/api/influencer/campaigns/[id]/apply/route.ts'), /if \(!priorRow\)/)
  assert.match(read('src/app/api/influencer/campaigns/open/route.ts'), /pendingMap\.has\(c\.id as string\) \|\| audience\.allows/)
})

test('/api/campaigns/[id]/audience: autoriza (admin o marca dueña) antes de acceder a datos', () => {
  const source = read('src/app/api/campaigns/[id]/audience/route.ts')
  const handlers = source.split(/export async function /).slice(1)
  assert.equal(handlers.length, 2)
  for (const handler of handlers) {
    const authAt = handler.indexOf('authorizeCampaignLocations(')
    const dataAt = handler.search(/admin\s*\.from\(|loadAudienceTargets\(|loadLocationRows\(/)
    assert.ok(authAt >= 0 && authAt < dataAt, 'la autorización debe preceder a cualquier consulta')
    assert.match(handler, /if \(!access\.ok\) return access\.response/)
  }
  assert.match(handlers[1], /'campaign\.manage'/)
  assert.match(handlers[0], /'campaign\.read'/)
  assert.match(source, /isUuid\(params\.id\)/)
})

test('PUT audience: agrega antes de quitar, para no dejar la campaña abierta por un fallo a medias', () => {
  const source = read('src/app/api/campaigns/[id]/audience/route.ts')
  assert.ok(source.indexOf('.upsert(') < source.indexOf('.delete()'))
})

test('migración: tabla cerrada a anon/authenticated y limitada a nodos geográficos', () => {
  const sql = read('supabase/migrations/20261029150000_campaign_audience_locations.sql')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.campaign_audience_locations FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /level NOT IN \('country', 'region', 'city', 'commune'\)/)
  assert.doesNotMatch(sql, /ALTER TABLE public\.campaign_locations/)
})

test('independencia: la segmentación no toca la dirección del evento ni sus tablas', () => {
  for (const file of ['src/lib/campaign-audience.ts', 'src/app/api/campaigns/[id]/audience/route.ts', 'src/components/locations/CampaignAudienceEditor.tsx']) {
    assert.doesNotMatch(read(file), /from\('campaign_locations'\)|syncCampaignPrimaryLocation|metadata\.address|legacy_location/)
  }
})

test('duplicar conserva la segmentación (borrador) y descarta la copia si no puede copiarla', () => {
  const source = read('src/app/api/campaigns/[id]/duplicate/route.ts')
  assert.match(source, /from\('campaign_audience_locations'\)\s*\.insert\(/)
  assert.match(source, /status: 'draft'/)
  assert.match(source, /delete\(\)\.eq\('id', campaign\.id\)/)
})

test('influencer sin ubicación recibe aviso para completar su perfil', () => {
  const page = read('src/app/(influencer)/inf-campaigns/page.tsx')
  assert.match(page, /!profileResult\.value\.location_id/)
  assert.match(page, /missing-location-banner/)
  assert.match(page, /href="\/inf-profile"/)
})

test('URL de perfil social se deriva del usuario (la influencer solo escribe su @)', async () => {
  const { socialProfileUrl } = await import('../src/lib/social-profile-url.ts')
  assert.equal(socialProfileUrl('instagram', '@Ana.Perez'), 'https://www.instagram.com/Ana.Perez')
  assert.equal(socialProfileUrl('tiktok', 'ana'), 'https://www.tiktok.com/@ana')
  assert.equal(socialProfileUrl('instagram', '  '), null)
  assert.equal(socialProfileUrl('otra', 'ana'), null)
  assert.doesNotMatch(read('src/app/(influencer)/inf-profile/page.tsx'), /URL perfil/)
  assert.doesNotMatch(read('src/app/api/influencer/me/route.ts'), /profile_url: sp\.profile_url/)
})

test('editor de zonas: País → Región → Comunas (varias) con selectores dependientes y chip LATAM agrupado', () => {
  const editor = read('src/components/locations/CampaignAudienceEditor.tsx')
  assert.match(editor, /fetchNodes\('parent=root'\)/)
  assert.match(editor, /fetchNodes\(`parent=\$\{encodeURIComponent\(id\)\}`\)/)
  assert.match(editor, /function MultiSelect/)
  assert.match(editor, /LATAM · \$\{latamIds\.length\} países/)
  // sigue guardando por la misma API y solo ids de locations
  assert.match(editor, /location_ids: next\.map\(z => z\.id\)/)
})
