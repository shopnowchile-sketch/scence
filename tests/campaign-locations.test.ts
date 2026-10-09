// Direcciones de campaña (campaign_locations → public.locations).
// Cubre: armado de la dirección, qué ve cada rol, principal, sincronización a
// bookings / campaigns.metadata y que el texto histórico se conserve y se pueda restaurar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./support/ts-resolve.mjs', import.meta.url)

import {
  applyPrimaryToBooking,
  applyPrimaryToMetadata,
  formatLocationDisplay,
  geographyFromBreadcrumb,
  loadCampaignLocations,
  locationsForInfluencer,
  normalizeInstructions,
  sortCampaignLocations,
  syncCampaignPrimaryLocation,
  campaignLocationDbError,
  type CampaignLocation,
} from '../src/lib/campaign-locations.ts'
import { createFakeSupabase } from './support/fake-supabase.ts'

const BREADCRUMB = [
  { id: 'c1', name: 'Chile', level: 'country' },
  { id: 'r1', name: 'Región Metropolitana', level: 'region' },
  { id: 'm1', name: 'Las Condes', level: 'commune' },
  { id: 'p1', name: 'Bar La Virgen', level: 'place' },
]

function loc(partial: Partial<CampaignLocation> = {}): CampaignLocation {
  return {
    id: 'link-1', location_id: 'p1', is_primary: true, sort_order: 0, instructions: 'Ingreso por calle lateral',
    name: 'Bar La Virgen', address: 'Av. Apoquindo 1234', commune: 'Las Condes', city: null,
    region: 'Región Metropolitana', country: 'Chile', display: '', ...partial,
  }
}

function fakeWithRpc(tables: Record<string, Record<string, unknown>[]>) {
  const fake = createFakeSupabase(tables)
  const client = Object.assign(fake.client as object, {
    rpc: (name: string, args: { p_id: string }) =>
      Promise.resolve(name === 'location_breadcrumb'
        ? { data: args.p_id === 'p2' ? [{ id: 'c1', name: 'Chile', level: 'country' }, { id: 'r2', name: 'Valparaíso', level: 'region' }, { id: 'm2', name: 'Viña del Mar', level: 'commune' }] : BREADCRUMB, error: null }
        : { data: null, error: { message: 'rpc desconocida' } }),
  })
  return { ...fake, client: client as never }
}

test('formatLocationDisplay: una línea sin repetir partes iguales', () => {
  assert.equal(formatLocationDisplay({ name: 'Bar La Virgen', address: 'Av. Apoquindo 1234', commune: 'Las Condes', region: 'Región Metropolitana' }),
    'Bar La Virgen · Av. Apoquindo 1234 · Las Condes, Región Metropolitana')
  assert.equal(formatLocationDisplay({ name: 'Las Condes', address: null, commune: 'Las Condes', region: null }), 'Las Condes')
})

test('geographyFromBreadcrumb: deriva comuna/región/país del árbol (nunca de texto)', () => {
  assert.deepEqual(geographyFromBreadcrumb(BREADCRUMB), { commune: 'Las Condes', city: null, region: 'Región Metropolitana', country: 'Chile' })
  assert.deepEqual(geographyFromBreadcrumb(null), { commune: null, city: null, region: null, country: null })
})

test('la principal va primero; el resto por orden', () => {
  const sorted = sortCampaignLocations([
    { id: 'b', is_primary: false, sort_order: 1 }, { id: 'c', is_primary: false, sort_order: 2 }, { id: 'a', is_primary: true, sort_order: 5 },
  ])
  assert.deepEqual(sorted.map(r => r.id), ['a', 'b', 'c'])
})

test('influencer pendiente: nombre y comuna sí; dirección exacta e indicaciones NO', () => {
  const [view] = locationsForInfluencer([loc()], false) as Array<Record<string, unknown>>
  assert.equal(view.name, 'Bar La Virgen')
  assert.equal(view.commune, 'Las Condes')
  assert.equal(view.address_hidden, true)
  for (const secret of ['address', 'instructions', 'location_id', 'id', 'display']) {
    assert.equal(secret in view, false, `no debe exponer ${secret}`)
  }
})

test('influencer aceptada: ve la dirección completa e indicaciones', () => {
  const [view] = locationsForInfluencer([loc({ display: 'x' })], true) as CampaignLocation[]
  assert.equal(view.address, 'Av. Apoquindo 1234')
  assert.equal(view.instructions, 'Ingreso por calle lateral')
})

test('normalizeInstructions: vacío → null, largo máximo y tipo', () => {
  assert.deepEqual(normalizeInstructions('  hola  '), { ok: true, value: 'hola' })
  assert.deepEqual(normalizeInstructions('   '), { ok: true, value: null })
  assert.deepEqual(normalizeInstructions(undefined), { ok: true, value: null })
  assert.equal(normalizeInstructions('x'.repeat(501)).ok, false)
  assert.equal(normalizeInstructions(42).ok, false)
})

test('errores de base → mensajes claros', () => {
  assert.equal(campaignLocationDbError({ code: '23505', message: 'dup' }).status, 409)
  assert.equal(campaignLocationDbError({ code: '23514', message: 'El lugar "x" pertenece a otra marca' }).status, 422)
  assert.equal(campaignLocationDbError({ code: '22P02', message: 'uuid' }).status, 400)
})

test('metadata: guarda el texto histórico UNA vez y lo restaura al quitar todas las direcciones', () => {
  const original = { address: 'Dirección vieja 1', commune: 'Providencia', venue_name: null, other: 'se conserva' }
  const withPrimary = applyPrimaryToMetadata(original, loc())
  assert.equal(withPrimary.address, 'Av. Apoquindo 1234')
  assert.equal(withPrimary.venue_name, 'Bar La Virgen')
  assert.equal(withPrimary.other, 'se conserva')
  assert.equal((withPrimary.legacy_location as Record<string, unknown>).address, 'Dirección vieja 1')

  // Cambiar de principal NO pisa el histórico con la dirección canónica anterior.
  const switched = applyPrimaryToMetadata(withPrimary, loc({ name: 'Otro', address: 'Otra 5' }))
  assert.equal((switched.legacy_location as Record<string, unknown>).address, 'Dirección vieja 1')

  const restored = applyPrimaryToMetadata(switched, null)
  assert.equal(restored.address, 'Dirección vieja 1')
  assert.equal(restored.commune, 'Providencia')
  assert.equal('legacy_location' in restored, false)
})

test('booking: copia la principal, preserva schedule y restaura el texto original', () => {
  const booking = { location: 'Calle vieja 9', location_id: null, location_details: { venue_name: 'Viejo', commune: 'Ñuñoa', schedule: [{ starts_at: 'x' }] } }
  const next = applyPrimaryToBooking(booking, loc())
  assert.equal(next.location, 'Av. Apoquindo 1234')
  assert.equal(next.location_id, 'p1')
  assert.equal(next.location_details.venue_name, 'Bar La Virgen')
  assert.equal(next.location_details.address_hidden, true)
  assert.deepEqual(next.location_details.schedule, [{ starts_at: 'x' }])

  const back = applyPrimaryToBooking({ location: next.location, location_id: next.location_id, location_details: next.location_details }, null)
  assert.equal(back.location, 'Calle vieja 9')
  assert.equal(back.location_id, null)
  assert.equal(back.location_details.venue_name, 'Viejo')
  assert.equal(back.location_details.commune, 'Ñuñoa')
  assert.deepEqual(back.location_details.schedule, [{ starts_at: 'x' }])
})

test('booking sin texto histórico y sin direcciones: queda vacío, sin inventar datos', () => {
  const back = applyPrimaryToBooking({ location: null, location_id: 'p1', location_details: {} }, null)
  assert.equal(back.location, null)
  assert.equal(back.location_id, null)
})

test('loadCampaignLocations: arma cada dirección desde locations + breadcrumb y la principal queda primera', async () => {
  const { client } = fakeWithRpc({
    campaign_locations: [
      { id: 'l2', campaign_id: 'camp', location_id: 'p2', is_primary: false, sort_order: 1, instructions: null },
      { id: 'l1', campaign_id: 'camp', location_id: 'p1', is_primary: true, sort_order: 0, instructions: 'Entrar por atrás' },
      { id: 'lx', campaign_id: 'otra', location_id: 'p1', is_primary: true, sort_order: 0, instructions: null },
    ],
    locations: [{ id: 'p1', name: 'Bar La Virgen', address: 'Av. Apoquindo 1234' }, { id: 'p2', name: 'Hotel Mar', address: null }],
  })
  const list = await loadCampaignLocations(client, 'camp')
  assert.deepEqual(list.map(l => l.id), ['l1', 'l2'])
  assert.equal(list[0].commune, 'Las Condes')
  assert.equal(list[1].commune, 'Viña del Mar')
  assert.equal(list[1].address, null)
})

test('syncCampaignPrimaryLocation: actualiza SOLO bookings de evento de esa campaña y su metadata', async () => {
  const { client, tables, writes } = fakeWithRpc({
    campaign_locations: [{ id: 'l1', campaign_id: 'camp', location_id: 'p1', is_primary: true, sort_order: 0, instructions: null }],
    locations: [{ id: 'p1', name: 'Bar La Virgen', address: 'Av. Apoquindo 1234' }],
    campaigns: [{ id: 'camp', metadata: { address: 'vieja' } }, { id: 'otra', metadata: { address: 'no tocar' } }],
    bookings: [
      { id: 'b-event', campaign_id: 'camp', event_type: 'event', influencer_id: null, status: 'confirmed', location: 'vieja', location_id: null, location_details: {} },
      { id: 'b-canceled', campaign_id: 'camp', event_type: 'event', influencer_id: null, status: 'canceled', location: 'vieja', location_id: null, location_details: {} },
      { id: 'b-influencer', campaign_id: 'camp', event_type: 'event', influencer_id: 'inf', status: 'confirmed', location: 'privada', location_id: null, location_details: {} },
      { id: 'b-otra', campaign_id: 'otra', event_type: 'event', influencer_id: null, status: 'confirmed', location: 'no tocar', location_id: null, location_details: {} },
    ],
  })
  await syncCampaignPrimaryLocation(client, 'camp')

  const byId = (id: string) => (tables.bookings as Array<Record<string, unknown>>).find(b => b.id === id)!
  assert.equal(byId('b-event').location, 'Av. Apoquindo 1234')
  assert.equal(byId('b-event').location_id, 'p1')
  assert.equal(byId('b-canceled').location, 'vieja')
  assert.equal(byId('b-influencer').location, 'privada')
  assert.equal(byId('b-otra').location, 'no tocar')
  assert.equal((tables.campaigns as Array<{ id: string; metadata: Record<string, unknown> }>).find(c => c.id === 'camp')!.metadata.address, 'Av. Apoquindo 1234')
  assert.equal((tables.campaigns as Array<{ id: string; metadata: Record<string, unknown> }>).find(c => c.id === 'otra')!.metadata.address, 'no tocar')
  assert.ok(writes.every(w => w.table === 'campaigns' || w.table === 'bookings'), 'nunca escribe en locations ni en campaign_locations')
})

test('syncCampaignPrimaryLocation: sin direcciones restaura el texto histórico de la campaña', async () => {
  const { client, tables } = fakeWithRpc({
    campaign_locations: [],
    locations: [],
    campaigns: [{ id: 'camp', metadata: { address: 'canónica', legacy_location: { address: 'Original 1', commune: 'Ñuñoa' } } }],
    bookings: [],
  })
  await syncCampaignPrimaryLocation(client, 'camp')
  const meta = (tables.campaigns as Array<{ metadata: Record<string, unknown> }>)[0].metadata
  assert.equal(meta.address, 'Original 1')
  assert.equal(meta.commune, 'Ñuñoa')
  assert.equal('legacy_location' in meta, false)
})
