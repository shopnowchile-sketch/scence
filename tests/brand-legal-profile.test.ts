// Perfil legal de marca — regresión del NDA de THE COLOR RUN (2026-11-02).
// Causa raíz: el RUT personal y el cargo se pedían en dos lugares (modal del NDA y Mi perfil) y la firma validaba
// contra una tercera fuente (profiles) ignorando lo escrito en el modal, sin decir qué faltaba ni adónde ir.
// Diseño: Organización es el único lugar de captura; el NDA lee los datos registrados, los muestra, indica
// exactamente qué falta y deja firmar solo al owner. Fuente única de reglas: src/lib/brand-legal-profile.ts.
//
// Handlers REALES contra una base EN MEMORIA con datos ficticios (sin red, sin Supabase, sin producción).
// LÍMITES: no prueba RLS/privilegios reales ni PostgreSQL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)

const { makeAdmin } = await import('./support/memory-supabase.ts')
const legal = await import('../src/lib/brand-legal-profile.ts')
const sign = await import('../src/app/api/brand/documents/[id]/route.ts')
const list = await import('../src/app/api/brand/documents/route.ts')
const me = await import('../src/app/api/brand/me/route.ts')
const collab = await import('../src/app/api/brand/collaboration-opportunities/route.ts')

type Row = Record<string, any>
type Db = Record<string, Row[]>

const m = (user_id: string, organization_id: string, role: string, brand_id: string | null, is_owner = false) =>
  ({ id: `m-${user_id}`, user_id, organization_id, role, brand_id, is_owner, is_active: true })

const TEMPLATE = 'EMPRESA {{brand_name}} RUT {{brand_rut}} DOM {{brand_address}} REP {{signer_name}} RUT {{signer_rut}} CARGO {{signer_role}}'
const COMPANY = { rut: '76.111.222-3', address_street: 'Av. Ficticia', address_number: '100', address_city: 'Las Condes', address_region: 'RM', address_country: 'Chile' }

function freshDb(): Db {
  return {
    brands: [
      { id: 'brand-A', organization_id: 'org-A', status: 'approved', name: 'Marca A', instagram: 'marca_a', contact_email: 'a@test.invalid', contact_name: 'Ana', ...COMPANY },
      { id: 'brand-B', organization_id: 'org-B', status: 'approved', name: 'Marca B' },
    ],
    organizations: [{ id: 'org-A', name: 'A' }, { id: 'org-B', name: 'B' }],
    organization_members: [
      m('uA-owner', 'org-A', 'brand_manager', 'brand-A', true), m('uA-member', 'org-A', 'member', 'brand-A'),
      m('uA-fin', 'org-A', 'finance', 'brand-A'), m('uB-owner', 'org-B', 'brand_manager', 'brand-B', true),
    ],
    brand_documents: [{ id: 'doc-A', brand_id: 'brand-A', template_id: 'tpl-1', status: 'pending', title: 'NDA A', document_type: 'nda', metadata: {}, content_snapshot: 'viejo', due_at: '2026-12-01' }],
    contract_templates: [{ id: 'tpl-1', content: TEMPLATE }],
    profiles: [{ id: 'uA-owner', full_name: 'Enzo Ficticio', signer_rut: '12.345.678-9', signer_role: 'Representante legal' }],
    notifications: [],
    campaigns: [],
  }
}

const as = (user: string | null, db: Db) => {
  ;(globalThis as any).__routeHarness = { user: user ? { id: user, email: `${user}@test.invalid` } : null, admin: makeAdmin(db, { projectColumns: true }) }
}
const req = (body?: unknown, url = 'http://localhost/api/brand/documents/doc-A') =>
  ({ url, headers: new Headers(), json: async () => body ?? {} }) as any

async function doSign(user: string | null, db: Db, body: Record<string, unknown> = { accepted: true }) {
  as(user, db)
  const res = await (sign as any).PATCH(req(body), { params: { id: 'doc-A' } })
  return { status: res.status as number, json: await res.json().catch(() => null) as any }
}
async function doList(user: string | null, db: Db) {
  as(user, db)
  const res = await (list as any).GET()
  return { status: res.status as number, json: await res.json().catch(() => null) as any }
}
async function patchMe(user: string | null, db: Db, body: Record<string, unknown>) {
  as(user, db)
  const res = await (me as any).PATCH(req(body, 'http://localhost/api/brand/me'))
  return { status: res.status as number, json: await res.json().catch(() => null) as any }
}
const FORM_A = { name: 'Marca A', instagram: 'marca_a', ...COMPANY }

// ── helper compartido ────────────────────────────────────────────────────────────────────────

test('helper: lista exactamente qué falta, separado por empresa y representante, y arma el domicilio', () => {
  assert.deepEqual(legal.missingCompanyLegalFields({ rut: ' ', address_street: 'x' }).map(f => f.key), ['rut', 'address_city', 'address_region', 'address_country'])
  assert.deepEqual(legal.missingRepresentativeFields({ full_name: 'A', signer_rut: null, signer_role: '' }).map(f => f.key), ['signer_rut', 'signer_role'])
  const all = legal.missingLegalFields({}, {})
  assert.equal(all.length, 8)
  assert.ok(all.every(f => f.label && (f.section === 'empresa' || f.section === 'representante')))
  assert.equal(legal.formatBrandAddress({ address_street: 'Calle', address_number: '5', address_city: 'Santiago', address_region: 'RM', address_country: 'Chile' }), 'Calle, 5, Santiago, RM, Chile')
  const ok = legal.buildBrandLegalProfile({ name: 'X', rut: '1-9', ...COMPANY }, { full_name: 'N', signer_rut: '2-7', signer_role: 'Rep' })
  assert.equal(ok.complete, true)
  assert.equal(legal.legalIncompleteBody(legal.missingLegalFields({}, {})).fix_url, '/brand-settings/organization')
})

// ── firma ─────────────────────────────────────────────────────────────────────────────────────

test('firma: el owner firma SIN pedir RUT ni cargo; usa los datos registrados y conserva copia histórica', async () => {
  const db = freshDb()
  const { status, json } = await doSign('uA-owner', db)
  assert.equal(status, 200, JSON.stringify(json))
  const doc = db.brand_documents[0]
  assert.equal(doc.status, 'signed')
  assert.equal(doc.signer_name, 'Enzo Ficticio')
  assert.equal(doc.signer_rut, '12.345.678-9')
  assert.equal(doc.signer_role, 'Representante legal')
  assert.equal(doc.signed_by, 'uA-owner')
  assert.ok(doc.signed_at && doc.accepted_at)
  assert.match(doc.content_snapshot, /EMPRESA Marca A RUT 76\.111\.222-3 DOM Av\. Ficticia, 100, Las Condes, RM, Chile REP Enzo Ficticio RUT 12\.345\.678-9 CARGO Representante legal/)
  assert.deepEqual(doc.metadata.signed_legal_data, {
    brand_name: 'Marca A', brand_rut: '76.111.222-3', brand_address: 'Av. Ficticia, 100, Las Condes, RM, Chile',
    signer_name: 'Enzo Ficticio', signer_rut: '12.345.678-9', signer_role: 'Representante legal', signer_user_id: 'uA-owner',
  })
})

test('firma: los signer_* que lleguen en el cuerpo se IGNORAN (una sola fuente de verdad)', async () => {
  const db = freshDb()
  const { status } = await doSign('uA-owner', db, { accepted: true, signer_name: 'Otro', signer_rut: '99-9', signer_role: 'Intruso' })
  assert.equal(status, 200)
  assert.equal(db.brand_documents[0].signer_name, 'Enzo Ficticio')
  assert.equal(db.brand_documents[0].signer_rut, '12.345.678-9')
  assert.equal(db.brand_documents[0].signer_role, 'Representante legal')
})

test('firma: falta RUT personal/cargo del owner (caso THE COLOR RUN) → 422 que dice exactamente qué falta y adónde ir; sigue pendiente', async () => {
  const db = freshDb()
  db.profiles = [{ id: 'uA-owner', full_name: 'Enzo Ficticio', signer_rut: null, signer_role: null }]
  const { status, json } = await doSign('uA-owner', db)
  assert.equal(status, 422)
  assert.equal(json.code, 'LEGAL_PROFILE_INCOMPLETE')
  assert.deepEqual(json.missing.map((f: any) => f.key), ['signer_rut', 'signer_role'])
  assert.equal(json.fix_url, '/brand-settings/organization')
  assert.match(json.error, /RUT personal del representante legal.*Cargo del representante legal.*Organización/)
  assert.equal(db.brand_documents[0].status, 'pending')
})

test('firma: sin fila de perfil → 422 con los 3 datos del representante; sin datos de empresa → 422 con cada campo', async () => {
  const noProfile = freshDb(); noProfile.profiles = []
  const r1 = await doSign('uA-owner', noProfile)
  assert.equal(r1.status, 422)
  assert.deepEqual(r1.json.missing.map((f: any) => f.key), ['full_name', 'signer_rut', 'signer_role'])
  for (const key of ['rut', 'address_street', 'address_city', 'address_region', 'address_country']) {
    const db = freshDb(); (db.brands[0] as Row)[key] = ' '
    const r = await doSign('uA-owner', db)
    assert.equal(r.status, 422, key)
    assert.deepEqual(r.json.missing.map((f: any) => f.key), [key])
    assert.equal(r.json.missing[0].section, 'empresa')
    assert.equal(db.brand_documents[0].status, 'pending')
  }
})

test('firma: exige aceptación explícita; nada se firma automáticamente', async () => {
  for (const body of [{}, { accepted: false }, { accepted: 'true' }, { signer_name: 'x', signer_rut: '1-9', signer_role: 'y' }]) {
    const db = freshDb()
    assert.equal((await doSign('uA-owner', db, body as any)).status, 422, JSON.stringify(body))
    assert.equal(db.brand_documents[0].status, 'pending')
  }
  // ni GET ni PATCH de otro rol firman: tras listar, el documento sigue pendiente
  const db = freshDb(); await doList('uA-owner', db)
  assert.equal(db.brand_documents[0].status, 'pending')
})

test('permisos intactos: solo el owner firma; member, finance heredado, anónimo y owner de otra marca no', async () => {
  for (const [user, expected] of [['uA-member', 403], ['uA-fin', 403], [null, 401]] as const) {
    const db = freshDb()
    assert.equal((await doSign(user, db)).status, expected, String(user))
    assert.equal(db.brand_documents[0].status, 'pending')
  }
  const other = freshDb()
  other.profiles.push({ id: 'uB-owner', full_name: 'B', signer_rut: '1-9', signer_role: 'Rep' }); Object.assign(other.brands[1], COMPANY)
  assert.equal((await doSign('uB-owner', other)).status, 404)
  assert.equal(other.brand_documents[0].status, 'pending')
})

test('NDA firmado queda intacto: no se firma dos veces y editar el perfil o la empresa después no altera la copia histórica', async () => {
  const db = freshDb()
  assert.equal((await doSign('uA-owner', db)).status, 200)
  const before = JSON.stringify(db.brand_documents[0])
  db.profiles[0].signer_rut = '55.555.555-5'; db.profiles[0].full_name = 'Cambiado'; db.brands[0].rut = '77.777.777-7'
  assert.equal((await doSign('uA-owner', db)).status, 404)
  const listed = await doList('uA-owner', db)
  assert.equal(JSON.stringify(db.brand_documents[0]), before)
  const signed = listed.json.data.find((d: any) => d.id === 'doc-A')
  assert.equal(signed.signer_rut, '12.345.678-9')
  assert.match(signed.content_snapshot, /RUT 76\.111\.222-3/)
  assert.equal(signed.signer_name, 'Enzo Ficticio')
})

// ── listado / vista previa ──────────────────────────────────────────────────────────────────

test('listado: completo → muestra los datos registrados (solo lectura) y la vista previa usa al owner', async () => {
  const { status, json } = await doList('uA-owner', freshDb())
  assert.equal(status, 200)
  assert.equal(json.can_sign, true)
  assert.equal(json.legal_profile_complete, true)
  assert.deepEqual(json.missing, [])
  assert.deepEqual(json.legal_data, {
    company: { name: 'Marca A', rut: '76.111.222-3', address: 'Av. Ficticia, 100, Las Condes, RM, Chile' },
    representative: { name: 'Enzo Ficticio', rut: '12.345.678-9', role: 'Representante legal' },
  })
  assert.match(json.data[0].content_snapshot, /REP Enzo Ficticio RUT 12\.345\.678-9 CARGO Representante legal/)
})

test('listado: incompleto → dice qué falta y ofrece acceso directo a Organización; member sigue sin acceso (403)', async () => {
  const db = freshDb(); db.profiles = []; db.brands[0].rut = ''
  const { json } = await doList('uA-owner', db)
  assert.equal(json.legal_profile_complete, false)
  assert.deepEqual(json.missing.map((f: any) => f.key), ['rut', 'full_name', 'signer_rut', 'signer_role'])
  assert.equal(json.fix_url, '/brand-settings/organization')
  assert.ok(json.missing_legal_fields.includes('RUT de la empresa'))
  assert.equal((await doList('uA-member', freshDb())).status, 403)
  assert.equal((await doList(null, freshDb())).status, 401)
})

// ── Organización: único lugar de captura del representante ───────────────────────────────────

test('Organización: el owner guarda empresa + representante; se escribe en profiles (fuente de verdad) y el NDA queda firmable', async () => {
  const db = freshDb(); db.profiles = [{ id: 'uA-owner', full_name: 'Enzo', signer_rut: null, signer_role: null }]
  const r = await patchMe('uA-owner', db, { ...FORM_A, representative: { full_name: ' Enzo Ficticio ', signer_rut: ' 12.345.678-9 ', signer_role: 'Gerente General' } })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual({ ...db.profiles[0] }, { id: 'uA-owner', full_name: 'Enzo Ficticio', signer_rut: '12.345.678-9', signer_role: 'Gerente General', updated_at: db.profiles[0].updated_at })
  assert.equal((await doSign('uA-owner', db)).status, 200)
  assert.equal(db.brand_documents[0].signer_role, 'Gerente General')
})

test('Organización: validación legal de la empresa viene del helper (400 con la etiqueta) y no escribe nada', async () => {
  const db = freshDb()
  const r = await patchMe('uA-owner', db, { ...FORM_A, rut: '' , representative: { signer_rut: '1-9' } })
  assert.equal(r.status, 400)
  assert.match(r.json.error, /RUT de la empresa es obligatorio/)
  assert.equal(db.profiles[0].signer_rut, '12.345.678-9')
})

test('Organización: nombre del representante no puede quedar vacío; no se toca la marca ni el perfil', async () => {
  const db = freshDb()
  const r = await patchMe('uA-owner', db, { ...FORM_A, name: 'Marca A2', representative: { full_name: '  ' } })
  assert.equal(r.status, 400)
  assert.equal(db.brands[0].name, 'Marca A')
  assert.equal(db.profiles[0].full_name, 'Enzo Ficticio')
})

test('Organización: solo el owner edita al representante; member sin permiso (403) y otro owner no pisa perfiles ajenos', async () => {
  const db = freshDb()
  assert.equal((await patchMe('uA-member', db, { ...FORM_A, representative: { signer_rut: '0-0' } })).status, 403)
  assert.equal((await patchMe(null, db, { ...FORM_A })).status, 401)
  assert.equal(db.profiles[0].signer_rut, '12.345.678-9')
  // el representante siempre es el usuario de la sesión: no hay forma de indicar otro perfil
  const spoof = freshDb(); spoof.profiles.push({ id: 'uB-owner', full_name: 'B', signer_rut: 'B-1', signer_role: 'B' })
  await patchMe('uA-owner', spoof, { ...FORM_A, representative: { signer_rut: '8-8', id: 'uB-owner', user_id: 'uB-owner' } })
  assert.equal(spoof.profiles.find(p => p.id === 'uB-owner')!.signer_rut, 'B-1')
})

test('Organización: PATCH sin bloque representante no toca el perfil (compatibilidad con guardados antiguos)', async () => {
  const db = freshDb()
  assert.equal((await patchMe('uA-owner', db, { ...FORM_A, name: 'Marca A v2' })).status, 200)
  assert.equal(db.brands[0].name, 'Marca A v2')
  assert.equal(db.profiles[0].signer_rut, '12.345.678-9')
})

// ── collaboration-opportunities: RUT legal desde brands.rut ─────────────────────────────────

async function postCollab(db: Db) {
  as('uA-owner', db)
  const res = await (collab as any).POST(req({ campaign_id: 'camp-1' }, 'http://localhost/api/brand/collaboration-opportunities'))
  return { status: res.status as number, json: await res.json().catch(() => null) as any }
}

test('collaboration-opportunities: usa brands.rut; una marca con RUT legal ya no es bloqueada por falta de metadata.rut/legal_name', async () => {
  const withRut = freshDb(); (withRut.brands[0] as Row).metadata = {}
  const ok = await postCollab(withRut)
  assert.ok(!/datos de facturación/.test(ok.json?.error ?? ''), JSON.stringify(ok.json))
  // y al revés: metadata.rut/legal_name/tax_id/billing_email ya no sustituyen al RUT registrado
  const onlyMeta = freshDb(); Object.assign(onlyMeta.brands[0], { rut: '', metadata: { rut: '1-9', legal_name: 'X', tax_id: '1-9', billing_email: 'x@test.invalid' } })
  const blocked = await postCollab(onlyMeta)
  assert.equal(blocked.status, 422)
  assert.match(blocked.json.error, /datos de facturación/)
})

// ── guardias estáticas contra reintroducir reglas duplicadas ──────────────────────────────────

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('guardia: ninguna ruta de firma/listado/onboarding/organización duplica la lista de obligatorios legales', () => {
  for (const file of ['../src/app/api/brand/documents/[id]/route.ts', '../src/app/api/brand/documents/route.ts']) {
    const src = read(file)
    assert.match(src, /brand-legal-profile/, file)
    assert.doesNotMatch(src, /address_street, brand\??\.address_city/, `${file}: lista duplicada de obligatorios`)
  }
  assert.doesNotMatch(read('../src/app/api/brand/documents/[id]/route.ts'), /body\??\.signer_/)
  assert.match(read('../src/app/api/brand/onboarding/route.ts'), /missingCompanyLegalFields/)
  assert.match(read('../src/app/api/brand/me/route.ts'), /missingCompanyLegalFields/)
  assert.match(read('../src/components/brand/BrandOrgForm.tsx'), /missingCompanyLegalFields/)
})

test('guardia: el NDA no vuelve a pedir RUT ni cargo y Mi perfil ya no captura al representante', () => {
  const page = read('../src/app/(brand)/brand-documents/page.tsx')
  assert.doesNotMatch(page, /placeholder="RUT"|placeholder="Cargo"|setRut|setRole/)
  assert.match(page, /Completar en Organización/)
  assert.doesNotMatch(read('../src/app/(dashboard)/admin-settings/profile/page.tsx'), /signer_rut|signer_role|RUT personal/)
  assert.match(read('../src/components/brand/BrandOrgForm.tsx'), /representante-legal/)
})

test('guardia: collaboration-opportunities no depende de metadata.rut/legal_name', () => {
  const src = read('../src/app/api/brand/collaboration-opportunities/route.ts')
  assert.doesNotMatch(src, /meta\.legal_name|meta\.rut|meta\.tax_id|meta\.billing_email/)
  assert.match(src, /select\('id,name,instagram,contact_email,contact_name,rut'\)/)
})
