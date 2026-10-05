import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('campaigns has canonical location architecture', () => {
  const migration = read('supabase/migrations/20261005180000_campaigns_locations_source_of_truth.sql')
  assert.match(migration, /campaigns\s*\n\s*ADD COLUMN IF NOT EXISTS location_id uuid/i)
  assert.match(migration, /campaigns_location_id_fkey/i)
  assert.match(migration, /campaigns_location_id_idx/i)
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*physical_locations/i)
})

test('campaign creation and duplication persist location_id', () => {
  assert.match(read('src/app/api/campaigns/route.ts'), /location_id:\s*canonicalLocationId/)
  assert.match(read('src/app/api/brand/campaigns/route.ts'), /location_id:\s*canonicalLocationId/)
  assert.match(read('src/app/api/campaigns/[id]/duplicate/route.ts'), /location_id:\s*source\.location_id/)
})

test('bookings inherit the campaign Location and persist location_id', () => {
  const source = read('src/app/api/bookings/route.ts')
  assert.match(source, /from\('campaigns'\)[\s\S]*select\('location_id'\)/)
  assert.match(source, /location_id:\s*canonicalLocationId/)
})

test('events use the canonical Location resolver', () => {
  const source = read('src/app/api/events/route.ts')
  assert.match(source, /resolvePhysicalLocation/)
  assert.match(source, /location_id:\s*canonicalLocationId/)
})

test('RLS keeps locations closed and separates brand access from influencer homes', () => {
  const migration = read('supabase/migrations/20261005180000_campaigns_locations_source_of_truth.sql')
  assert.match(migration, /locations_platform_admin_read/)
  assert.match(migration, /locations_brand_activity_read/)
  assert.match(migration, /type.*influencer_home|influencer_home.*type/)
  assert.match(migration, /is_private/)
})

test('admin campaign location editing resolves a canonical Location', () => {
  const source = read('src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx')
  assert.match(source, /\/api\/locations\/resolve/)
  assert.match(source, /location_id:\s*resolved\.locationId/)
})
