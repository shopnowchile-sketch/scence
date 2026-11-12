// Regresiones de la ficha de marcas (2026-11-12). Guardias estáticas sobre el código fuente (sin red ni base).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('brands.notes es exclusivo de Admin: las rutas de influencer no lo leen, escriben ni devuelven', () => {
  for (const path of ['src/app/api/influencer/owned-brands/route.ts', 'src/app/api/influencer/owned-brands/[id]/route.ts']) {
    const code = src(path)
    assert.doesNotMatch(code, /formText\(form, 'notes'\)/, `${path} escribe notes`)
    assert.doesNotMatch(code, /instagram, notes,/, `${path} selecciona notes`)
    assert.match(code, /notes: _adminNotes/, `${path} debe quitar notes de la respuesta`)
  }
  const page = src('src/app/(influencer)/inf-brands/page.tsx')
  assert.doesNotMatch(page, /notes/, 'la pantalla de influencer no debe mostrar ni editar notes')
})

test('brands.notes: el registro desde el portal de marca no lo escribe ni lo devuelve', () => {
  const code = src('src/app/api/brand/brands/route.ts')
  assert.doesNotMatch(code, /notes: body\.notes/)
  assert.match(code, /notes: _adminNotes/)
})

test('ningún pago ni webhook de PayPal reactiva una marca suspendida', () => {
  const webhook = src('src/app/api/paypal/webhook/route.ts')
  assert.doesNotMatch(webhook, /from\('brands'\)/, 'el webhook no debe escribir brands')
  const complete = src('src/app/api/paypal/complete/route.ts')
  assert.match(complete, /\.eq\('status', 'pending_approval'\)/, 'pagar solo aprueba marcas pendientes')
})

test('una marca suspendida ve el aviso de suspensión y no se redirige a Planes', () => {
  const layout = src('src/app/(brand)/layout.tsx')
  assert.doesNotMatch(layout, /brandStatus === 'suspended' && !isPlanPage\) router\.replace/)
  assert.match(layout, /Esta marca se encuentra suspendida\. Contacta a soporte para solicitar una revisión\./)
  assert.doesNotMatch(layout, /período de acceso gratuito/)
})

test('el formulario de Direcciones reutiliza el buscador de Google Maps y invalida coordenadas al editar a mano', () => {
  const form = src('src/components/brand/BrandAddressForm.tsx')
  assert.match(form, /import \{ GooglePlacesAddress \}/)
  assert.match(form, /address_place_id: address\.placeId, address_lat: address\.lat, address_lng: address\.lng/)
  assert.match(form, /address_place_id: '', address_lat: null, address_lng: null/)
})

test('rechazar una invitación guarda rejected_at (antes quedaba sin fecha)', () => {
  const code = src('src/app/api/influencer/campaigns/[id]/apply/route.ts')
  assert.match(code, /application_status: 'rejected', rejected_at: rejectedAt, updated_at: rejectedAt/)
})

test('toda aceptación o rechazo nuevo guarda su fecha (accepted_at / rejected_at)', () => {
  assert.match(src('src/app/api/influencer/my-campaigns/route.ts'), /application_status: 'accepted',\s*accepted_at:/)
  assert.match(src('src/lib/campaign-applications.ts'), /application_status: 'accepted',[\s\S]{0,120}accepted_at: acceptedAt/)
  assert.match(src('src/lib/campaign-applications.ts'), /application_status: 'rejected', rejected_at: rejectedAt/)
  assert.match(src('src/app/api/cron/close-expired-campaign-applications/route.ts'), /application_status: 'rejected',[\s\S]{0,200}rejected_at: now/)
})

test('KPI de entregables: solo participantes aceptadas (Admin y portal de marca)', () => {
  const admin = src('src/app/api/campaigns/route.ts')
  assert.equal((admin.match(/eq\('campaign_influencers\.application_status', 'accepted'\)/g) ?? []).length, 2)
  assert.match(src('src/app/api/brand/campaigns/route.ts'), /acceptedInfluencerIds/)
})

test('«Total gastado» no se muestra mientras budget_spent no tenga un cálculo confiable', () => {
  const ui = src('src/app/(dashboard)/admin-campaigns/CampaignsClient.tsx')
  assert.doesNotMatch(ui, /label: 'Total gastado'/)
  assert.doesNotMatch(ui, /\} gastado\{/)
})

test('influencers sin redes muestran «Sin redes registradas»', () => {
  assert.match(src('src/components/influencers/InfluencerRanking.tsx'), /Sin redes registradas/)
  assert.match(src('src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx'), /Sin redes registradas/)
})
