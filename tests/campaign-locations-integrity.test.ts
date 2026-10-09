// Integridad de la dirección canónica en TODA la app: ninguna ruta de escritura
// puede pisarla con datos antiguos, la influencer nunca ve más de lo que le
// corresponde y las campañas históricas siguen funcionando con su texto.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

const {
  applyPrimaryToMetadata, canonicalBookingFields, lockCanonicalLocationMetadata, locationsForInfluencer, stripLegacyLocation,
} = await import('../src/lib/campaign-locations.ts')

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const primary = {
  id: 'l1', location_id: 'p1', is_primary: true, sort_order: 0, instructions: 'Entrar por atrás', name: 'Bar La Virgen',
  address: 'Av. Apoquindo 1234', commune: 'Las Condes', city: null, region: 'Región Metropolitana', country: 'Chile', display: 'x',
}

test('un PUT con datos antiguos NO pisa la dirección canónica', () => {
  const existing = applyPrimaryToMetadata({ address: 'Original', other: 1 }, primary)
  const stale = { ...existing, address: 'DATO ANTIGUO', venue_name: 'ANTIGUO', commune: 'ANTIGUA', other: 2, access_mode: 'public' }
  const locked = lockCanonicalLocationMetadata(existing, stale)
  assert.equal(locked.address, 'Av. Apoquindo 1234')
  assert.equal(locked.venue_name, 'Bar La Virgen')
  assert.equal(locked.commune, 'Las Condes')
  assert.equal(locked.other, 2, 'los demás campos sí se actualizan')
  assert.equal(locked.access_mode, 'public')
  assert.deepEqual(locked.legacy_location, (existing as { legacy_location: unknown }).legacy_location, 'el histórico no se altera')
})

test('campaña histórica (sin direcciones canónicas): el PUT sigue escribiendo su texto como siempre', () => {
  const existing = { address: 'Vieja 1', commune: 'Ñuñoa' }
  const incoming = { address: 'Nueva 2', commune: 'Providencia' }
  assert.deepEqual(lockCanonicalLocationMetadata(existing, incoming), incoming)
})

test('booking del evento: location y location_id salen JUNTOS de la principal (nunca uno sin el otro)', () => {
  const fields = canonicalBookingFields(primary)
  assert.equal(fields.location, 'Av. Apoquindo 1234')
  assert.equal(fields.location_id, 'p1')
  assert.equal(fields.details.address_hidden, true)
  const noAddress = canonicalBookingFields({ ...primary, address: null })
  assert.equal(noAddress.location, null)
  assert.equal(noAddress.location_id, 'p1')
  assert.equal(noAddress.details.address_hidden, false, 'sin dirección no se promete una "oculta"')
})

test('privacidad: el texto histórico (legacy_location) nunca llega a la influencer', () => {
  const stripped = stripLegacyLocation({ venue_name: 'x', legacy_location: { location: 'dirección vieja' }, schedule: [1] })
  assert.deepEqual(stripped, { venue_name: 'x', schedule: [1] })
  assert.equal(stripLegacyLocation(null), null)
  assert.equal(stripLegacyLocation([1]), null)
})

test('privacidad: pendiente/rechazada solo ve nombre y comuna, aceptada ve todo, en cada dirección', () => {
  const second = { ...primary, id: 'l2', location_id: 'p2', is_primary: false, name: 'Hotel Mar', address: 'Mar 5', instructions: 'Piso 3' }
  const pending = locationsForInfluencer([primary, second], false) as Array<Record<string, unknown>>
  assert.equal(pending.length, 2)
  for (const view of pending) {
    assert.equal('address' in view, false)
    assert.equal('instructions' in view, false)
    assert.equal(view.address_hidden, true)
  }
  const accepted = locationsForInfluencer([primary, second], true) as Array<Record<string, unknown>>
  assert.equal(accepted[1].address, 'Mar 5')
  assert.equal(accepted[1].instructions, 'Piso 3')
})

// ── Cada ruta de escritura aplica la guarda (leído del código fuente) ────────
test('bookings POST y PUT: el evento toma la principal; location y location_id se escriben juntos', () => {
  const src = read('src/app/api/bookings/route.ts')
  assert.equal((src.match(/canonicalBookingLocationForCampaign\(/g) ?? []).length, 2, 'POST y PUT')
  assert.match(src, /location_id: canonicalLocation\?\.location_id \?\? null/, 'POST escribe location_id')
  assert.match(src, /\.\.\.rest, \.\.\.canonicalFields/, 'PUT aplica la dirección canónica DESPUÉS de lo que envía el cliente')
  assert.match(src, /event_type === 'event' && !primaryInfluencerId/, 'solo el booking general del evento')
  assert.match(src, /existing\.event_type === 'event' && !existing\.influencer_id/)
  // Calendar usa la misma dirección que la base
  assert.match(src, /location: canonicalLocation \? canonicalLocation\.location : clientLocation|const location = canonicalLocation/)
})

test('PUT de campaña (admin y marca) conserva la dirección canónica', () => {
  assert.match(read('src/app/api/campaigns/[id]/route.ts'), /lockCanonicalLocationMetadata\(existingMetadata/)
  assert.match(read('src/app/api/brand/campaigns/[id]/route.ts'), /lockCanonicalLocationMetadata\(campaignBase\.metadata/)
})

test('lectura: admin y marca reciben TODAS las direcciones de su campaña; la influencer, redactadas en el servidor', () => {
  assert.match(read('src/app/api/campaigns/[id]/route.ts'), /locations: await loadCampaignLocations\(admin, params\.id\)/)
  assert.match(read('src/app/api/brand/campaigns/[id]/route.ts'), /locations: await loadCampaignLocations\(admin, params\.id\)/)
  const detail = read('src/app/api/influencer/campaigns/[id]/route.ts')
  assert.match(detail, /locationsForInfluencer\(await loadCampaignLocations\(admin, params\.id\)\.catch\(\(\) => \[\]\), isAccepted\)/)
  assert.match(detail, /stripLegacyLocation\(eventBooking\.location_details\)/)
  const mine = read('src/app/api/influencer/my-campaigns/route.ts')
  assert.match(mine, /locationsForInfluencer\(/)
  assert.match(mine, /stripLegacyLocation\(booking\.location_details\)/)
  assert.match(mine, /row\.application_status === 'accepted' \|\| row\._self_created === true/)
})

test('histórico: si la lectura de direcciones falla o no hay filas, nada se rompe (fallback a [])', () => {
  for (const file of ['src/app/api/campaigns/[id]/route.ts', 'src/app/api/brand/campaigns/[id]/route.ts', 'src/app/api/influencer/campaigns/[id]/route.ts']) {
    assert.match(read(file), /loadCampaignLocations\(admin, params\.id\)\.catch\(\(\) => \[\]\)/, file)
  }
})

test('formulario de creación: ya no envía texto de ubicación ni lo pisa; las direcciones se asocian antes de los bookings', () => {
  const form = read('src/app/(dashboard)/admin-campaigns/new/CampaignForm.tsx')
  assert.doesNotMatch(form, /venueName|arrivalInstructions|values\.commune|data\.commune|data\.address/)
  assert.doesNotMatch(form, /location_details:/)
  const create = form.indexOf('await flushPendingLocations(campaign.id)')
  assert.ok(create > 0 && create < form.indexOf('await syncEventBookings(campaign.id, getValues())', create), 'saveDraft: direcciones antes de bookings')
  const submit = form.indexOf('await flushPendingLocations(savedCampaignId)')
  assert.ok(submit > 0 && submit < form.indexOf('await syncEventBookings(savedCampaignId, data)', submit), 'onSubmit: direcciones antes de bookings')
  assert.match(form, /setPendingLocations\(failed\)/, 'las que fallan se conservan, no se pierden')
})

test('detalle de campaña: guardar el resumen ya no escribe texto de ubicación (lo hace solo el editor canónico)', () => {
  const detail = read('src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx')
  assert.doesNotMatch(detail, /summaryEditForm\.(location|venue_name|commune|region|country|location_instructions)/)
  assert.doesNotMatch(detail, /brandLocations|handleAddBrandLocation/)
  assert.match(detail, /<CampaignLocationsEditor campaignId=\{id\}/)
  assert.equal((detail.match(/<CampaignLocationsEditor /g) ?? []).length, 2, 'encabezado y pestaña Lugares')
})

test('editor: tras cualquier cambio refresca la ficha, incluso si el guardado fue parcial', () => {
  const editor = read('src/components/locations/CampaignLocationsEditor.tsx')
  assert.doesNotMatch(editor, /if \(await server\./, 'no condicionar el refresco al éxito')
  assert.ok((editor.match(/onChanged\?\.\(\)/g) ?? []).length >= 4)
  assert.match(read('src/hooks/useCampaignLocations.ts'), /setItems\(await call\(`\/api\/campaigns\/\$\{campaignId\}\/locations`\)\)/, 'recarga el estado real tras un error')
})

test('selector: nunca ofrece domicilios de influencer ni lugares privados', () => {
  const picker = read('src/components/locations/PhysicalLocationPicker.tsx')
  assert.match(picker, /!n\.is_private && n\.type !== 'influencer_home'/)
  assert.match(picker, /apiBase === '\/api\/brand\/locations'/)
})
