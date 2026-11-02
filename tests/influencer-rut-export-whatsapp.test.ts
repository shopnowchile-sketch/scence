// Mejoras 2026-11-02: RUT privado de influencer, exportación de campaña con selector de columnas y WhatsApp.
// Handlers REALES contra una base EN MEMORIA con datos ficticios (sin red, sin Supabase, sin producción).
// LÍMITES: no prueba RLS/privilegios reales ni PostgreSQL (la migración se verifica aparte en DEV).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { register } from 'node:module'

// El prebuild de Vercel ejecuta estas pruebas con VERCEL_ENV=production: nunca deben tener efectos externos.
process.env.VERCEL_ENV = 'test'
register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const rut = await import('../src/lib/rut.ts')
const phone = await import('../src/lib/phone.ts')
const cols = await import('../src/lib/campaign-export-columns.ts')
const exp = await import('../src/app/api/campaigns/[id]/influencers/export/route.ts')
const rutRoute = await import('../src/app/api/influencer/rut/route.ts')

type Row = Record<string, any>
const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) =>
  ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

const fresh = (): Record<string, Row[]> => ({
  brands: [{ id: 'brand-A', organization_id: 'org-A', status: 'approved', name: 'Marca A' }, { id: 'brand-B', organization_id: 'org-B', status: 'approved', name: 'Marca B' }],
  organization_members: [
    m('uOwnerA', 'org-A', 'brand_manager', 'brand-A', true), m('uMemA', 'org-A', 'member', 'brand-A'),
    m('uOwnerB', 'org-B', 'brand_manager', 'brand-B', true), m('uAdmin', 'org-adm', 'super_admin', null),
  ],
  campaigns: [{ id: 'camp-A', name: 'Campaña A', organization_id: 'org-A', brand_id: 'brand-A', created_by_brand_id: null, type: 'ugc', status: 'active', metadata: {} }],
  influencers: [
    { id: 'inf-1', user_id: 'uInf1', display_name: 'Ana Confirmada', email: 'ana@test.invalid', phone: '+56 9 1111 1111', whatsapp: null, location_id: 'loc-com', categories: ['Moda'] },
    { id: 'inf-2', user_id: 'uInf2', display_name: 'Beto Sin Confirmar', email: 'beto@test.invalid', phone: '+56 9 2222 2222', whatsapp: null, location_id: null, categories: [] },
    { id: 'inf-3', user_id: 'uInf3', display_name: 'Cata Rechazada', email: 'cata@test.invalid', phone: null, whatsapp: null, location_id: null, categories: [] },
  ],
  influencer_social_profiles: [{ id: 's1', influencer_id: 'inf-1', platform: 'instagram', username: 'ana', followers: 1000, engagement_rate: 3.2 }],
  campaign_influencers: [
    { id: 'ci1', campaign_id: 'camp-A', influencer_id: 'inf-1', application_status: 'accepted', fee: 100, currency: 'CLP', accepted_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' },
    { id: 'ci2', campaign_id: 'camp-A', influencer_id: 'inf-2', application_status: 'accepted', fee: 50, currency: 'CLP', accepted_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' },
    { id: 'ci3', campaign_id: 'camp-A', influencer_id: 'inf-3', application_status: 'rejected', fee: 0, currency: 'CLP', accepted_at: null, updated_at: '2026-10-03T10:00:00Z' },
  ],
  campaign_deliverables: [
    { id: 'd1', campaign_id: 'camp-A', influencer_id: 'inf-1', type: 'event_attendance', status: 'approved', attendance_response: 'confirmed', due_date: '2099-01-01', content_url: null, published_url: null },
    { id: 'd2', campaign_id: 'camp-A', influencer_id: 'inf-1', type: 'reel', status: 'approved', attendance_response: null, due_date: '2099-01-01', content_url: 'x', published_url: null },
    { id: 'd3', campaign_id: 'camp-A', influencer_id: 'inf-1', type: 'story', status: 'pending', attendance_response: null, due_date: '2000-01-01', content_url: null, published_url: null },
    { id: 'd4', campaign_id: 'camp-A', influencer_id: 'inf-2', type: 'event_attendance', status: 'pending', attendance_response: null, due_date: '2099-01-01', content_url: null, published_url: null },
  ],
  locations: [
    { id: 'loc-cty', parent_id: null, level: 'country', name: 'Chile', is_active: true },
    { id: 'loc-reg', parent_id: 'loc-cty', level: 'region', name: 'Región Metropolitana', is_active: true },
    { id: 'loc-com', parent_id: 'loc-reg', level: 'commune', name: 'Las Condes', is_active: true },
  ],
  influencer_private_data: [{ influencer_id: 'inf-1', rut: '12345678-5' }, { influencer_id: 'inf-3', rut: '11111111-1' }],
})
// La base en memoria no resuelve relaciones embebidas: se adjunta cada `influencer:influencers(...)` a su fila.
const withEmbeds = (db: Record<string, Row[]>) => {
  for (const ci of db.campaign_influencers) {
    const inf = db.influencers.find(i => i.id === ci.influencer_id)
    ci.influencer = inf ? { ...inf, influencer_social_profiles: db.influencer_social_profiles.filter(s => s.influencer_id === inf.id) } : null
  }
  return db
}
const as = (user: string | null, db = withEmbeds(fresh())) => {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, user_metadata: {} } : null, admin: makeAdmin(db) }
  return db
}
const mk = (url: string, body: unknown = {}) => ({ url, json: async () => body, headers: new Headers(), nextUrl: new URL(url) }) as any
const ctx = { params: { id: 'camp-A' } }
const get = (user: string | null, query = '') => { as(user); return (exp as any).GET(mk(`http://x/api/campaigns/camp-A/influencers/export?${query}`), ctx) as Promise<Response> }
const csv = async (user: string | null, query: string) => (await (await get(user, `${query}&format=csv`)).text()).replace(/^﻿/, '').trim().split('\r\n')

// ── RUT ────────────────────────────────────────────────────────────────────────
test('RUT: normaliza, valida dígito verificador (incluida K) y formatea', () => {
  assert.equal(rut.normalizeRut('12.345.678-5'), '12345678-5')
  assert.equal(rut.normalizeRut(' 12345678 5 '), '12345678-5')
  assert.equal(rut.normalizeRut('6.000.000-k'), '6000000-K')
  assert.equal(rut.isValidRut('12.345.678-5'), true)
  assert.equal(rut.isValidRut('12.345.678-4'), false)
  assert.equal(rut.isValidRut('1-9'), false)
  assert.equal(rut.isValidRut('abc'), false)
  assert.equal(rut.isValidRut(''), false)
  assert.equal(rut.rutCheckDigit('6000000'), 'K')
  assert.equal(rut.isValidRut('6.000.000-K'), true)
  assert.equal(rut.formatRut('123456785'), '12.345.678-5')
})

test('RUT API: 401 sin sesión, 403 si no es influencer, 422 si es inválido, guarda normalizado y solo lee el propio', async () => {
  as(null); assert.equal((await (rutRoute as any).GET()).status, 401)
  as('uOwnerA'); assert.equal((await (rutRoute as any).GET()).status, 403)
  as('uOwnerA'); assert.equal((await (rutRoute as any).PUT(mk('http://x', { rut: '12.345.678-5' }))).status, 403)

  const db = as('uInf2')
  assert.equal((await (rutRoute as any).PUT(mk('http://x', { rut: '12.345.678-4' }))).status, 422)
  assert.equal(db.influencer_private_data.some(r => r.influencer_id === 'inf-2'), false)
  const ok = await (rutRoute as any).PUT(mk('http://x', { rut: '  12.345.678-5 ', influencer_id: 'inf-1' }))
  assert.equal(ok.status, 200)
  assert.equal(db.influencer_private_data.find(r => r.influencer_id === 'inf-2')?.rut, '12345678-5')
  // El cuerpo no puede apuntar a otra influencer: la fila de inf-1 no cambió.
  assert.equal(db.influencer_private_data.find(r => r.influencer_id === 'inf-1')?.rut, '12345678-5')
  assert.equal((await (await (rutRoute as any).GET()).json()).data.rut, '12345678-5')
  // vacío = borrar el dato (opcional)
  assert.equal((await (rutRoute as any).PUT(mk('http://x', { rut: '' }))).status, 200)
  assert.equal(db.influencer_private_data.find(r => r.influencer_id === 'inf-2')?.rut, null)
})

// ── Exportación ────────────────────────────────────────────────────────────────
test('export: sin parámetros = comportamiento histórico (solo confirmadas, columnas por defecto, Excel)', async () => {
  const res = await get('uAdmin')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Type') ?? '', /spreadsheetml/)
  const lines = await csv('uAdmin', '')
  assert.equal(lines.length, 2) // cabecera + Ana
  assert.match(lines[0], /^Nombre,Email,Teléfono,WhatsApp,Instagram,Seguidores,Engagement \(%\),Comuna,Categorías,Fee,Moneda,Fecha de aceptación$/)
  assert.match(lines[1], /^Ana Confirmada,ana@test\.invalid,\+56 9 1111 1111,/)
})

test('export: filtro confirmadas / aprobadas (sin confirmar) / ambas, nunca rechazadas', async () => {
  const names = async (filter: string) => (await csv('uAdmin', `filter=${filter}&columns=name`)).slice(1)
  assert.deepEqual(await names('confirmed'), ['Ana Confirmada'])
  assert.deepEqual(await names('approved'), ['Beto Sin Confirmar'])
  assert.deepEqual(await names('all'), ['Ana Confirmada', 'Beto Sin Confirmar'])
  assert.deepEqual(await names('inventado'), ['Ana Confirmada']) // filtro desconocido → el histórico
})

test('export: selector de columnas (asistencia, entregables con lógica única, región y país); orden del catálogo', async () => {
  const lines = await csv('uAdmin', 'filter=all&columns=deliverables,country,attendance,region,name')
  assert.equal(lines[0], 'Nombre,Estado de asistencia,Región,País,Estado de entregables')
  assert.equal(lines[1], 'Ana Confirmada,Confirmada,Región Metropolitana,Chile,1/2 completados · 1 vencido')
  assert.equal(lines[2], 'Beto Sin Confirmar,Pendiente,,,Sin entregables')
})

test('export: RUT solo de aceptadas, y SOLO el Super Admin descarga: ninguna marca (owner, member u otra) ni sin sesión', async () => {
  const lines = await csv('uAdmin', 'filter=all&columns=name,rut')
  assert.deepEqual(lines, ['Nombre,RUT', 'Ana Confirmada,12.345.678-5', 'Beto Sin Confirmar,'])
  assert.ok(!lines.join('\n').includes('11.111.111'), 'el RUT de una influencer rechazada nunca sale')
  for (const brandUser of ['uOwnerA', 'uMemA', 'uOwnerB']) {
    for (const query of ['', 'columns=name', 'filter=all&columns=name,phone,email', 'filter=all&columns=name,rut', 'format=csv']) {
      const res = await get(brandUser, query)
      assert.equal(res.status, 403, `${brandUser} ?${query}`)
      const body = await res.text()
      assert.doesNotMatch(body, /ana@test|beto@test|\+56 9|12\.345\.678|Ana Confirmada/)
    }
  }
  assert.equal((await get(null, 'columns=name')).status, 401)
})

test('export: lista cerrada (claves desconocidas se ignoran), sin columnas → 422, CSV con BOM y fórmulas neutralizadas', async () => {
  assert.equal((await get('uAdmin', 'columns=password,organization_id')).status, 422)
  const res = await get('uAdmin', 'columns=name&format=csv')
  assert.match(res.headers.get('Content-Type') ?? '', /text\/csv/)
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)], [0xEF, 0xBB, 0xBF])
  assert.equal(cols.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(cols.csvCell('+56 9 1111 1111'), '+56 9 1111 1111')
  assert.equal(cols.csvCell('a,b'), '"a,b"')
  assert.deepEqual(cols.parseExportColumns('email,xx,name,email'), ['name', 'email'])
})

// ── WhatsApp ───────────────────────────────────────────────────────────────────
test('WhatsApp: normaliza con código de país y descarta números inusables', () => {
  assert.equal(phone.whatsappUrl('+56 9 9172 6186', 'Chile'), 'https://wa.me/56991726186')
  assert.equal(phone.whatsappUrl('+56991726186', 'Chile'), 'https://wa.me/56991726186')
  assert.equal(phone.whatsappUrl('991726186', 'Chile'), 'https://wa.me/56991726186')
  assert.equal(phone.whatsappUrl('0056991726186'), 'https://wa.me/56991726186')
  assert.equal(phone.whatsappUrl('abc', 'Chile'), null)
  assert.equal(phone.whatsappUrl('', 'Chile'), null)
  assert.equal(phone.whatsappUrl(null), null)
})

// ── Guardias estáticas ─────────────────────────────────────────────────────────
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('migración: la tabla privada no da acceso a anon/authenticated y solo service_role opera', () => {
  const sql = read('supabase/migrations/20261102120000_influencer_private_data.sql')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on public\.influencer_private_data from anon, authenticated/i)
  assert.match(sql, /grant select, insert, update on public\.influencer_private_data to service_role/i)
  assert.doesNotMatch(sql, /grant[^;]*(anon|authenticated)/i)
})

test('el RUT no vive en influencers ni se selecciona fuera de la tabla privada y las rutas autorizadas', () => {
  const walk = (dir: string): string[] => {
    return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap(name => {
      const rel = `${dir}/${name}`
      return statSync(new URL(`../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : [rel]
    })
  }
  const users = walk('src').filter(file => /\.(ts|tsx)$/.test(file) && /from\(['"]influencer_private_data['"]\)/.test(read(file)))
  assert.deepEqual(users.sort(), [
    'src/app/api/campaigns/[id]/influencers/export/route.ts',
    'src/app/api/influencer/rut/route.ts',
  ])
  assert.doesNotMatch(read('src/app/api/influencer/rut/route.ts'), /body\??\.influencer_id|body\??\.user_id/)
})

test('WhatsApp: los teléfonos visibles usan el componente compartido (sin tel: sueltos)', () => {
  for (const file of [
    'src/app/(dashboard)/admin-influencers/[id]/InfluencerProfile.tsx',
    'src/app/(dashboard)/admin-brands/[id]/page.tsx',
    'src/app/(dashboard)/admin-brands/page.tsx',
    'src/app/(dashboard)/admin-crm/[id]/CrmLeadDetailClient.tsx',
    'src/app/(influencer)/inf-brands/page.tsx',
    'src/app/(influencer)/inf-profile/page.tsx',
    'src/components/campaigns/CollaboratingBrandsTab.tsx',
  ]) {
    const src = read(file)
    assert.match(src, /<PhoneLink /, file)
    assert.doesNotMatch(src, /href=\{`tel:/, file)
  }
})
