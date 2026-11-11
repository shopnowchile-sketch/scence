// Impulso Consulting (agencia multimarca): administración de varias marcas y mensualidad PayPal por marca.
// Ejecuta librerías y handlers REALES contra una base en memoria (sin red, sin PayPal, sin producción).
// LÍMITES: no prueba PayPal real (sandbox sin credenciales cargadas), RLS ni la UI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./support/ts-resolve.mjs', import.meta.url)
register('./support/route-harness.mjs', import.meta.url)
const { makeAdmin } = await import('./support/memory-supabase.ts')
const agency = await import('../src/lib/agency-brands.ts')

type Row = Record<string, any>
const FUTURE = new Date(Date.now() + 20 * 86_400_000).toISOString()
const PAST = new Date(Date.now() - 10 * 86_400_000).toISOString()
const sub = (org: string, brandId: string | null, over: Row = {}): Row => ({
  id: `sub-${org}-${Math.random()}`, organization_id: org, status: 'active', current_period_end: FUTURE, paypal_subscription_id: `I-${org}`,
  metadata: { account_type: 'brand', ...(brandId ? { brand_id: brandId } : {}) }, plan: { tier: 'agency' }, ...over,
})
const fresh = (): Record<string, Row[]> => ({
  organizations: [
    { id: 'org-IC', settings: { agency_portal: true } }, { id: 'org-other-agency', settings: { agency_portal: true } },
    { id: 'org-A', settings: {} }, { id: 'org-B', settings: {} }, { id: 'org-X', settings: {} }, { id: 'org-Z', settings: {} },
  ],
  organization_members: [
    { id: 'm1', user_id: 'isabel', organization_id: 'org-IC', role: 'brand_manager', is_owner: true, is_active: true, brand_id: 'brand-IC' },
    { id: 'm2', user_id: 'icMember', organization_id: 'org-IC', role: 'brand_manager', is_owner: false, is_active: true, brand_id: 'brand-IC' },
    { id: 'm3', user_id: 'other', organization_id: 'org-other-agency', role: 'brand_manager', is_owner: true, is_active: true, brand_id: 'brand-OA' },
    { id: 'm4', user_id: 'ownerX', organization_id: 'org-X', role: 'brand_manager', is_owner: true, is_active: true, brand_id: 'brand-X' },
  ],
  brands: [
    { id: 'brand-IC', name: 'Impulso Consulting', organization_id: 'org-IC', status: 'approved', metadata: {}, subscription_plan_override: null },
    { id: 'brand-A', name: 'Marca A', organization_id: 'org-A', status: 'approved', metadata: { managed_by_org_id: 'org-IC' }, subscription_plan_override: null },
    { id: 'brand-B', name: 'Marca B', organization_id: 'org-B', status: 'approved', metadata: { managed_by_org_id: 'org-IC' }, subscription_plan_override: null },
    { id: 'brand-OA', name: 'Otra agencia', organization_id: 'org-other-agency', status: 'approved', metadata: {}, subscription_plan_override: null },
    { id: 'brand-Z', name: 'Marca de otra agencia', organization_id: 'org-Z', status: 'approved', metadata: { managed_by_org_id: 'org-other-agency' }, subscription_plan_override: null },
    { id: 'brand-X', name: 'Marca normal', organization_id: 'org-X', status: 'approved', metadata: {}, subscription_plan_override: null },
  ],
  subscriptions: [],
  campaigns: [
    { id: 'camp-A', brand_id: 'brand-A', created_by_brand_id: 'brand-A', organization_id: 'org-A', status: 'draft', visibility: 'private', metadata: {}, deliverable_templates: [] },
    { id: 'camp-B', brand_id: 'brand-B', created_by_brand_id: 'brand-B', organization_id: 'org-B', status: 'draft', visibility: 'private', metadata: {}, deliverable_templates: [] },
    { id: 'camp-X', brand_id: 'brand-X', created_by_brand_id: 'brand-X', organization_id: 'org-X', status: 'draft', visibility: 'private', metadata: {}, deliverable_templates: [] },
  ],
  campaign_brands: [],
})
const adminWith = (db = fresh()) => ({ db, admin: makeAdmin(db, { signedBrandFixtures: true }) as any })

// ── Reglas puras de la mensualidad ───────────────────────────────────────────
test('agencyMonthIsCurrent: activa vigente, gracia, vencida, cancelada, otro plan y override', () => {
  const now = Date.now()
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b')], null, now), true)
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { current_period_end: new Date(now - 3_600_000).toISOString() })], null, now), true, 'dentro de la gracia de 48 h con PayPal ACTIVE')
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { current_period_end: PAST })], null, now), false, 'período vencido')
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { status: 'canceled', current_period_end: PAST })], null, now), false)
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { status: 'canceled' })], null, now), true, 'cancelada con período pagado futuro')
  for (const status of ['past_due', 'incomplete', 'unpaid', 'paused']) assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { status })], null, now), false, status)
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { plan: { tier: 'pro' } })], null, now), true, 'plan existente con acceso: no se vuelve a cobrar')
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { plan: { tier: 'pro' }, status: 'past_due' })], null, now), false, 'plan existente sin acceso (past_due)')
  assert.equal(agency.agencyMonthIsCurrent([sub('o', 'b', { metadata: { account_type: 'influencer' } })], null, now), false)
  assert.equal(agency.agencyMonthIsCurrent([], 'pro', now), true, 'override administrativo')
  assert.equal(agency.agencyMonthIsCurrent([], null, now), false)
})

// ── Alcance de la agencia ────────────────────────────────────────────────────
test('resolveAgencyContext: solo el owner de una org agency_portal', async () => {
  const { admin } = adminWith()
  assert.deepEqual(await agency.resolveAgencyContext(admin, 'isabel'), { organizationId: 'org-IC', userId: 'isabel' })
  assert.equal(await agency.resolveAgencyContext(admin, 'icMember'), null, 'miembro no owner')
  assert.equal(await agency.resolveAgencyContext(admin, 'ownerX'), null, 'marca normal')
  assert.equal(await agency.resolveAgencyContext(admin, 'nadie'), null)
})

test('resolveAgencyBrandAccess: marcas propias y administradas sí; marcas de otra agencia o ajenas no', async () => {
  const { admin } = adminWith()
  for (const id of ['brand-IC', 'brand-A', 'brand-B']) {
    const access = await agency.resolveAgencyBrandAccess(admin, 'isabel', id)
    assert.equal(access?.brandId, id); assert.equal(access?.role, 'owner')
  }
  for (const id of ['brand-OA', 'brand-Z', 'brand-X', 'no-existe']) assert.equal(await agency.resolveAgencyBrandAccess(admin, 'isabel', id), null, id)
  assert.equal(await agency.resolveAgencyBrandAccess(admin, 'other', 'brand-A'), null, 'otra agencia no ve las marcas de IC')
  assert.equal(await agency.resolveAgencyBrandAccess(admin, 'ownerX', 'brand-A'), null, 'una marca normal no gana permisos')
  assert.equal(await agency.resolveAgencyBrandAccess(admin, 'icMember', 'brand-A'), null, 'un miembro no owner de IC tampoco')
})

test('listAgencyBrands: las de la agencia (propia + administradas), nunca las de otra', async () => {
  const { admin } = adminWith()
  const ids = (await agency.listAgencyBrands(admin, 'org-IC')).map((b: Row) => b.id).sort()
  assert.deepEqual(ids, ['brand-A', 'brand-B', 'brand-IC'])
})

// ── Una suscripción por marca ────────────────────────────────────────────────
test('brandHasCurrentSubscription: cada marca con su suscripción; la de una no habilita a otra', async () => {
  const db = fresh(); db.subscriptions.push(sub('org-A', 'brand-A'))
  const { admin } = adminWith(db)
  assert.equal(await agency.brandHasCurrentSubscription(admin, 'brand-A'), true)
  assert.equal(await agency.brandHasCurrentSubscription(admin, 'brand-B'), false)
  assert.equal(await agency.brandHasCurrentSubscription(admin, 'brand-IC'), false)
  // Una fila atada a otra marca dentro de la misma organización no cuenta.
  db.subscriptions.push(sub('org-B', 'brand-A'))
  assert.equal(await agency.brandHasCurrentSubscription(admin, 'brand-B'), false)
})

test('isAgencyScopedBrand: IC y sus marcas sí; una marca normal no (su flujo no cambia)', async () => {
  const { admin } = adminWith()
  assert.equal(await agency.isAgencyScopedBrand(admin, 'brand-IC'), true)
  assert.equal(await agency.isAgencyScopedBrand(admin, 'brand-A'), true)
  assert.equal(await agency.isAgencyScopedBrand(admin, 'brand-X'), false)
})

// ── Compuerta en «Enviar a aprobación» (handler real) ────────────────────────
const req = (body: unknown) => ({ url: 'http://localhost/api/brand/campaigns/x', json: async () => body, headers: new Headers() }) as any
const as = (user: string, db: Record<string, Row[]>, cookies: Record<string, string> = {}) => {
  ;(globalThis as any).__routeHarness = { user: { id: user }, admin: makeAdmin(db, { signedBrandFixtures: true }), cookies }
}
const submit = async (campaignId: string) => {
  const route = await import('../src/app/api/brand/campaigns/[id]/route.ts')
  return (route as any).PATCH(req({ action: 'submit_for_approval' }), { params: { id: campaignId } })
}
const ACTIVE = { scence_active_brand: 'brand-A' }

test('enviar a aprobación sin mensualidad: 402 con la marca de la campaña y la campaña no cambia', async () => {
  const db = fresh(); as('isabel', db, ACTIVE)
  const res = await submit('camp-A')
  assert.equal(res.status, 402)
  const json = await res.json()
  assert.equal(json.code, 'AGENCY_SUBSCRIPTION_REQUIRED'); assert.equal(json.brand_id, 'brand-A')
  assert.equal(db.campaigns.find(c => c.id === 'camp-A')!.status, 'draft')
})

test('con la mensualidad vigente de ESA marca: pasa a pending_approval, nunca a active', async () => {
  const db = fresh(); db.subscriptions.push(sub('org-A', 'brand-A')); as('isabel', db, ACTIVE)
  const res = await submit('camp-A')
  assert.equal(res.status, 200)
  assert.equal(db.campaigns.find(c => c.id === 'camp-A')!.status, 'pending_approval')
})

test('la mensualidad de la marca A no habilita enviar campañas de la marca B', async () => {
  const db = fresh(); db.subscriptions.push(sub('org-A', 'brand-A'))
  // Isabel trabaja con la marca B activa
  as('isabel', db, { scence_active_brand: 'brand-B' })
  const res = await submit('camp-B')
  assert.equal(res.status, 402)
  assert.equal((await res.json()).brand_id, 'brand-B')
  assert.equal(db.campaigns.find(c => c.id === 'camp-B')!.status, 'draft')
  // Aunque tenga A activa, no puede enviar una campaña de B (la campaña no es de la marca activa)
  as('isabel', db, ACTIVE)
  const cross = await submit('camp-B')
  assert.notEqual(cross.status, 200)
  assert.equal(db.campaigns.find(c => c.id === 'camp-B')!.status, 'draft')
})

test('toda marca: guardar y editar borradores es gratis (sin suscripción)', async () => {
  const db = fresh(); as('ownerX', db)
  const route = await import('../src/app/api/brand/campaigns/[id]/route.ts')
  const res = await (route as any).PATCH(req({ name: 'Borrador editado', description: 'texto' }), { params: { id: 'camp-X' } })
  assert.equal(res.status, 200)
  assert.equal(db.campaigns.find(c => c.id === 'camp-X')!.status, 'draft')
  // Un borrador público no se bloquea por el tope de plan: el límite se aplica al enviar a revisión.
  db.campaigns.push({ id: 'camp-X-open', brand_id: 'brand-X', created_by_brand_id: 'brand-X', organization_id: 'org-X', status: 'open-previous', visibility: 'open', metadata: {}, deliverable_templates: [] })
  const open = await (route as any).PATCH(req({ visibility: 'open' }), { params: { id: 'camp-X' } })
  assert.equal(open.status, 200)
})

test('toda marca sin suscripción: «Enviar a aprobación» pide el pago (402) y la campaña sigue en borrador', async () => {
  const db = fresh(); as('ownerX', db)
  const res = await submit('camp-X')
  assert.equal(res.status, 402)
  const json = await res.json()
  assert.equal(json.code, 'AGENCY_SUBSCRIPTION_REQUIRED'); assert.equal(json.brand_id, 'brand-X')
  assert.equal(db.campaigns.find(c => c.id === 'camp-X')!.status, 'draft')
})

test('suscripciones existentes (Basic/Growth/Pro) y overrides siguen valiendo: sin cobrar de nuevo', async () => {
  for (const tier of ['basic', 'growth', 'pro']) {
    const db = fresh(); db.subscriptions.push(sub('org-X', 'brand-X', { plan: { tier }, paypal_subscription_id: `I-${tier}` })); as('ownerX', db)
    assert.equal((await submit('camp-X')).status, 200, tier)
    assert.equal(db.campaigns.find(c => c.id === 'camp-X')!.status, 'pending_approval', tier)
  }
  const db = fresh(); db.brands.find(b => b.id === 'brand-X')!.subscription_plan_override = 'pro'; as('ownerX', db)
  assert.equal((await submit('camp-X')).status, 200, 'override administrativo')
})

test('la suscripción de una marca no habilita a otra marca normal', async () => {
  const db = fresh(); db.subscriptions.push(sub('org-A', 'brand-A', { plan: { tier: 'pro' } }))
  db.campaigns.push({ id: 'camp-Y', brand_id: 'brand-Y', created_by_brand_id: 'brand-Y', organization_id: 'org-Y', status: 'draft', visibility: 'private', metadata: {}, deliverable_templates: [] })
  db.brands.push({ id: 'brand-Y', name: 'Y', organization_id: 'org-Y', status: 'approved', metadata: {}, subscription_plan_override: null })
  db.organization_members.push({ id: 'm5', user_id: 'ownerY', organization_id: 'org-Y', role: 'brand_manager', is_owner: true, is_active: true, brand_id: 'brand-Y' })
  as('ownerY', db)
  assert.equal((await submit('camp-Y')).status, 402)
})

test('el portal de marca ya no redirige a Planes ni bloquea por falta de suscripción', async () => {
  const { readFileSync } = await import('node:fs')
  const layout = readFileSync(new URL('../src/app/(brand)/layout.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(layout, /hasActiveSubscription/)
  // La única redirección a Planes que queda es la de marca suspendida.
  const redirects = layout.match(/router\.replace\('\/brand-settings\/plan'\)/g) ?? []
  assert.equal(redirects.length, 1)
  assert.match(layout, /brandStatus === 'suspended'[^\n]*router\.replace\('\/brand-settings\/plan'\)/)
})

test('cookie de marca activa ajena a la agencia se ignora (sin escalada de permisos)', async () => {
  const db = fresh(); as('ownerX', db, { scence_active_brand: 'brand-A' })
  const res = await submit('camp-A')
  assert.notEqual(res.status, 200)
  assert.equal(db.campaigns.find(c => c.id === 'camp-A')!.status, 'draft')
  as('isabel', db, { scence_active_brand: 'brand-Z' })
  assert.notEqual((await submit('camp-A')).status, 200, 'marca de otra agencia como activa: se ignora')
})

test('la marca no puede activar la campaña por su cuenta aunque haya pagado', async () => {
  const db = fresh(); db.subscriptions.push(sub('org-A', 'brand-A')); as('isabel', db, ACTIVE)
  const route = await import('../src/app/api/brand/campaigns/[id]/route.ts')
  const res = await (route as any).PATCH(req({ action: 'activate' }), { params: { id: 'camp-A' } })
  assert.equal(res.status, 403)
  assert.equal(db.campaigns.find(c => c.id === 'camp-A')!.status, 'draft')
})

test('marca nueva: borrador gratis, primero pago, luego NDA y recién entonces revisión', async () => {
  const db = fresh()
  db.brands.find(brand => brand.id === 'brand-X')!.status = 'pending_approval'
  db.brand_documents = []
  as('ownerX', db)
  const list = await import('../src/app/api/brand/campaigns/route.ts')
  const created = await list.POST(req({ name: 'Nuevo borrador', type: 'ugc', visibility: 'open' }))
  assert.equal(created.status, 201)
  assert.equal(db.campaigns.at(-1)?.status, 'draft')

  const campaign = db.campaigns.find(row => row.id === 'camp-X')!
  assert.equal((await submit(campaign.id)).status, 402)
  assert.equal(campaign.status, 'draft')
  db.subscriptions.push(sub('org-X', 'brand-X'))
  const unsigned = await submit(campaign.id)
  assert.equal(unsigned.status, 403)
  assert.equal((await unsigned.json()).code, 'BRAND_NDA_REQUIRED')
  assert.equal(campaign.status, 'draft')
  db.brand_documents.push({ id: 'nda', brand_id: 'brand-X', document_type: 'nda', status: 'signed' })
  assert.equal((await submit(campaign.id)).status, 200)
  assert.equal(campaign.status, 'pending_approval')
})

test('marca existente sin NDA: listado y enlace directo bloqueados; conserva perfil y firma', async () => {
  const db = fresh()
  db.brand_documents = [{ id: 'other-nda', brand_id: 'brand-A', document_type: 'nda', status: 'signed' }]
  as('ownerX', db)
  const list = await import('../src/app/api/brand/campaigns/route.ts')
  const response = await list.GET({ ...req({}), nextUrl: new URL('http://localhost/api/brand/campaigns') })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'BRAND_NDA_REQUIRED')
  const detail = await import('../src/app/api/brand/campaigns/[id]/route.ts')
  assert.equal((await detail.GET(req({}), { params: { id: 'camp-X' } })).status, 403)

  const { hasBrandPermission, resolveBrandAccess } = await import('../src/lib/supabase/ensureOrg.ts')
  const access = await resolveBrandAccess('ownerX')
  assert.equal(hasBrandPermission(access, 'brand.manage'), true)
  assert.equal(hasBrandPermission(access, 'legal_document.manage'), true)
  for (const permission of ['campaign.read', 'influencer.read', 'billing.read', 'team.read'] as const) {
    assert.equal(hasBrandPermission(access, permission), false, permission)
  }
})

test('una marca nueva no puede firmar el NDA antes del pago; una existente conserva la firma', async () => {
  const db = fresh()
  const brand = db.brands.find(row => row.id === 'brand-X')!
  brand.status = 'pending_approval'
  db.brand_documents = [{ id: 'nda-pending', brand_id: brand.id, document_type: 'nda', status: 'pending' }]
  as('ownerX', db)
  const route = await import('../src/app/api/brand/documents/[id]/route.ts')
  const sign = () => route.PATCH(req({ accepted: true }), { params: { id: 'nda-pending' } })
  assert.equal((await sign()).status, 402)
  assert.equal(db.brand_documents[0].status, 'pending')
  brand.status = 'approved'
  assert.equal((await sign()).status, 422, 'puede llegar a la validación de datos legales sin contratar un plan')
})

test('la edición genérica no puede cambiar el estado de una campaña de marca', async () => {
  const db = fresh()
  as('ownerX', db)
  const route = await import('../src/app/api/campaigns/[id]/route.ts')
  assert.equal((await route.PUT(req({ status: 'pending_approval' }), { params: { id: 'camp-X' } })).status, 403)
  assert.equal(db.campaigns.find(row => row.id === 'camp-X')?.status, 'draft')
})
