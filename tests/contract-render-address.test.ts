// La dirección de la campaña vive en campaigns.metadata.address. La columna campaigns.address
// está en desuso y puede eliminarse (migración drop_legacy_campaign_columns, pendiente): la
// generación de contratos NO debe consultarla. El cliente simulado falla como PostgREST si se
// pide una columna inexistente. Sin Supabase real.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildCampaignContractContext } from '../src/lib/contract-render.ts'

const DROPPED_COLUMNS = ['address', 'content_guidelines', 'do_follow_links', 'internal_notes', 'sorteo_winner']

function fakeAdmin(opts: { campaign: Record<string, unknown>; bookings?: Array<Record<string, unknown>> }) {
  const selects: string[] = []
  const admin = {
    from(table: string) {
      let selected = ''
      const chain: any = {
        select(cols: string) { selected = cols; if (table === 'campaigns') selects.push(cols); return chain },
        eq() { return chain },
        order() { return Promise.resolve({ data: opts.bookings ?? [], error: null }) },
        single() {
          const requested = selected.split(',').map(c => c.trim())
          const missing = requested.filter(c => DROPPED_COLUMNS.includes(c))
          if (table === 'campaigns' && missing.length) return Promise.resolve({ data: null, error: { message: `column campaigns.${missing[0]} does not exist` } })
          return Promise.resolve({ data: opts.campaign, error: null })
        },
        maybeSingle() { return Promise.resolve({ data: null, error: null }) },
      }
      return chain
    },
  }
  return { admin: admin as any, selects }
}

const baseCampaign = { id: 'c1', name: 'Campaña', description: null, type: 'event_appearance', start_date: null, end_date: null, brand_id: null, organization_id: 'o1', currency: 'CLP' }

describe('contract-render: dirección del evento sin la columna campaigns.address', () => {
  test('no pide ninguna columna en desuso (sobrevive a su eliminación)', async () => {
    const { admin, selects } = fakeAdmin({ campaign: { ...baseCampaign, metadata: { address: 'Av. Kennedy 5741' } } })
    await buildCampaignContractContext(admin, { campaignId: 'c1' })
    for (const col of DROPPED_COLUMNS) {
      assert.ok(!new RegExp(`(^|[ ,])${col}([ ,]|$)`).test(selects[0]), `el select de campaigns no debe pedir "${col}"`)
    }
  })

  test('sin booking ni override, el lugar sale de metadata.address (contrato y valores precargados)', async () => {
    const { admin } = fakeAdmin({ campaign: { ...baseCampaign, metadata: { address: 'Av. Kennedy 5741, Las Condes' } } })
    const { context, meta } = await buildCampaignContractContext(admin, { campaignId: 'c1' })
    assert.equal(context.event_location, 'Av. Kennedy 5741, Las Condes')
    assert.equal(meta.eventDefaults.location, 'Av. Kennedy 5741, Las Condes')
  })

  test('una propiedad "address" de la fila (columna vieja) se ignora', async () => {
    const { admin } = fakeAdmin({ campaign: { ...baseCampaign, address: 'COLUMNA VIEJA', metadata: { address: 'metadata' } } })
    const { context } = await buildCampaignContractContext(admin, { campaignId: 'c1' })
    assert.equal(context.event_location, 'metadata')
  })

  test('prioridad intacta: override del contrato > booking real > metadata.address', async () => {
    const booking = { id: 'b1', title: 'Evento', location: 'Lugar del booking', starts_at: '2026-11-14T21:00:00Z', ends_at: null }
    const base = { ...baseCampaign, metadata: { address: 'metadata' } }
    const conBooking = await buildCampaignContractContext(fakeAdmin({ campaign: base, bookings: [booking] }).admin, { campaignId: 'c1' })
    assert.equal(conBooking.context.event_location, 'Lugar del booking')
    const conOverride = await buildCampaignContractContext(fakeAdmin({ campaign: base, bookings: [booking] }).admin, { campaignId: 'c1', eventOverride: { location: '  Lugar manual  ' } })
    assert.equal(conOverride.context.event_location, 'Lugar manual')
  })

  test('sin ninguna fuente, el lugar queda sin resolver (no se inventa)', async () => {
    const { admin } = fakeAdmin({ campaign: { ...baseCampaign, metadata: {} } })
    const { context } = await buildCampaignContractContext(admin, { campaignId: 'c1' })
    assert.equal(context.event_location, undefined)
  })
})
