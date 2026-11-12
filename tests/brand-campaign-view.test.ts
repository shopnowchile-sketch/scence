// Vista de marca del detalle de campaña (2026-11-12): sin notas internas, sin metadata privada de participantes y
// sin contactos de otras marcas. Pruebas puras del helper + guardias sobre las dos rutas que lo usan.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { brandCampaignView } from '../src/lib/brand-influencer-privacy.ts'

const campaign = {
  id: 'c1', name: 'Campaña', internal_notes: 'solo admin',
  brand: { id: 'otra', name: 'Marca A', logo_url: 'l', website: 'w', contact_name: 'N', contact_email: 'a@x.cl' },
  campaign_brands: [{ id: 'cb', brand: { id: 'otra2', name: 'Marca B', instagram: 'b', contact_email: 'b@x.cl', contact_name: 'N' } }],
  campaign_influencers: [{
    id: 'ci', application_status: 'accepted', fee: null, notes: 'nota interna', message: 'm',
    metadata: { removal_reason: 'attendance_deadline', private_flag: true, last_reminder_sent_at: 't' },
    influencer: { id: 'i', display_name: 'X', email: 'x@x.cl', phone: '1', user_id: 'u' },
  }],
}

test('la marca no recibe notas internas ni metadata privada de participantes', () => {
  const view = brandCampaignView(campaign, 'propia')
  assert.equal('internal_notes' in view, false)
  const ci = view.campaign_influencers[0] as Record<string, any>
  assert.equal('notes' in ci, false)
  assert.equal('message' in ci, false)
  assert.deepEqual(ci.metadata, { removal_reason: 'attendance_deadline', last_reminder_sent_at: 't' })
  assert.equal('email' in ci.influencer, false)
  assert.equal('user_id' in ci.influencer, false)
})

test('contactos de otras marcas fuera; los de la propia marca se conservan', () => {
  const other = brandCampaignView(campaign, 'propia')
  assert.deepEqual(other.brand, { id: 'otra', name: 'Marca A', logo_url: 'l' })
  const bb = (other.campaign_brands[0] as any).brand
  assert.equal('contact_email' in bb, false)
  assert.equal(bb.name, 'Marca B')
  const own = brandCampaignView(campaign, 'otra')
  assert.equal((own.brand as any).contact_email, 'a@x.cl')
})

test('las dos rutas de detalle para marcas pasan por brandCampaignView', () => {
  for (const path of ['src/app/api/campaigns/[id]/route.ts', 'src/app/api/brand/campaigns/[id]/route.ts']) {
    assert.match(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), /brandCampaignView\(/, path)
  }
})
