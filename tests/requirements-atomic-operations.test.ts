import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/app/api/admin/requirements/[key]/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261021120000_requirements_atomic_operations.sql', import.meta.url), 'utf8')

test('propuestas usan una operación SQL transaccional y no calculan version_number en la API', () => {
  assert.match(route, /rpc\('propose_requirement_version'/)
  assert.doesNotMatch(route, /\.from\('requirement_versions'\)\.insert/)
  assert.match(migration, /FUNCTION public\.propose_requirement_version/)
  assert.match(migration, /FROM public\.requirements[\s\S]*FOR UPDATE/)
  assert.match(migration, /COALESCE\(MAX\(version_number\), 0\) \+ 1/)
  assert.match(migration, /UNIQUE \(requirement_id, version_number\)/)
})

test('aprobación cambia versión anterior, nueva versión, puntero y auditoría en una única función', () => {
  assert.match(route, /rpc\('approve_requirement_version'/)
  assert.doesNotMatch(route, /\.from\('requirement_versions'\)\.update/)
  assert.match(migration, /FUNCTION public\.approve_requirement_version/)
  assert.match(migration, /SET lifecycle_status = 'superseded'/)
  assert.match(migration, /SET lifecycle_status = 'approved'/)
  assert.match(migration, /SET approved_version_id = p_version_id/)
  assert.match(migration, /requirement\.version_approved/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.approve_requirement_version[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.approve_requirement_version[\s\S]*TO service_role/)
})

test('evidencia persistente se registra con RPC transaccional y evita duplicados', () => {
  assert.match(route, /action === 'add_evidence'/)
  assert.match(route, /rpc\('add_requirement_evidence'/)
  assert.match(route, /error\.code === '23505'/)
  assert.match(migration, /FUNCTION public\.add_requirement_evidence/)
  assert.match(migration, /requirement\.evidence_added/)
  assert.match(migration, /UNIQUE \(requirement_version_id, evidence_type, reference\)/)
})

test('API valida cuerpo, longitud, arrays y UUID; errores de lectura de evidencia no se silencian', () => {
  assert.match(route, /El cuerpo JSON no es válido/)
  assert.match(route, /10\.000 caracteres/)
  assert.match(route, /2\\.000 caracteres/)
  assert.match(route, /versionId debe ser un UUID válido/)
  assert.match(route, /No se pudo leer la evidencia/)
})
