import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboard = readFileSync(new URL('../src/app/api/dashboard/route.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/app/api/admin/requirements/[key]/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261010150000_requirements_source_of_truth.sql', import.meta.url), 'utf8')

test('DASH-001 separa el roster total del KPI de influencers activos', () => {
  assert.match(dashboard, /const totalInfluencers = influencersCountRes\.count \?\? 0/)
  assert.match(dashboard, /const activeInfluencers = activeInfluencersCountRes\.count \?\? 0/)
  assert.match(dashboard, /from\('influencers'\)[\s\S]{0,240}\.eq\('organization_id', orgId\)[\s\S]{0,120}\.eq\('is_active', true\)/)
  assert.match(dashboard, /total_influencers: totalInfluencers,[\s\S]{0,80}active_influencers: activeInfluencers/)
})

test('el piloto exige autorización de administrador de plataforma antes de leer o cambiar datos', () => {
  for (const handler of route.split(/export async function /).slice(1)) {
    const authAt = handler.indexOf('requirePlatformAdmin()')
    const queryAt = handler.indexOf(".from('")
    assert.ok(authAt >= 0 && (queryAt < 0 || authAt < queryAt))
  }
  assert.match(route, /isPlatformAdmin\(user\.id, admin\)/)
})

test('la migración conserva versiones, evidencia y RLS Admin-only para DASH-001', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.requirements/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.requirement_versions/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.requirement_evidence/)
  assert.match(migration, /ALTER TABLE public\.requirements ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /'DASH-001'/)
  assert.match(migration, /om\.role = 'super_admin'/)
  assert.match(migration, /AND lifecycle_status = 'proposed'/)
  assert.match(migration, /UNIQUE \(requirement_version_id, evidence_type, reference\)/)
})

test('la migración es re-ejecutable, inmutable en versiones aprobadas y con grants explícitos', () => {
  assert.equal((migration.match(/CREATE POLICY/g) ?? []).length, (migration.match(/DROP POLICY IF EXISTS/g) ?? []).length)
  assert.match(migration, /UNIQUE \(requirement_version_id, evidence_type, reference\)/)
  assert.match(migration, /AND lifecycle_status = 'proposed'\)/)
  assert.match(migration, /ON CONFLICT \(requirement_id, version_number\) DO NOTHING/)
  // El UPDATE de approved_version_id no puede ir dentro de un WITH que inserta la fila (no la vería).
  assert.doesNotMatch(migration, /WITH inserted_/)
  assert.match(migration, /UPDATE public\.requirements r\s+SET approved_version_id = v\.id/)
  assert.match(migration, /GRANT ALL ON public\.requirements, public\.requirement_versions, public\.requirement_evidence TO service_role/)
  assert.match(migration, /REVOKE ALL ON public\.requirements[^;]*FROM anon/)
})

test('la página y el middleware restringen /admin-requirements a administradores de plataforma', () => {
  const page = readFileSync(new URL('../src/app/(dashboard)/admin-requirements/page.tsx', import.meta.url), 'utf8')
  const middleware = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
  assert.match(page, /isPlatformAdmin\(user\.id, createAdminClient\(\)\)/)
  assert.match(page, /redirect\('\/admin-dash'\)/)
  assert.match(middleware, /ADMIN_ONLY = \[[\s\S]*'\/admin-requirements'[\s\S]*\]/)
})
