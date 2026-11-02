// La búsqueda del roster admin se resuelve en Postgres (search_text), sin listas de ids en la URL de PostgREST.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../src/app/api/influencers/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20261102140000_influencer_search_text.sql', import.meta.url), 'utf8')

test('la ruta admin no pasa ids de ubicación en .or() (causa del 500 con términos cortos)', () => {
  assert.doesNotMatch(route, /location_id\.in\.\(\$\{/)
  assert.doesNotMatch(route, /locationSearchIds/)
})

test('los tres puntos de búsqueda comparten el mismo filtro sobre search_text y email', () => {
  assert.match(route, /search_text\.ilike\.%\$\{normalizeLocationName\(search\)\}%,email\.ilike\.%\$\{search\}%/)
  assert.equal((route.match(/\.or\(searchFilter\)/g) ?? []).length, 3)
})

test('la migración mantiene search_text por triggers, con índice trigram y sin email', () => {
  assert.match(migration, /trg_influencers_search_text/)
  assert.match(migration, /trg_locations_refresh_influencer_search/)
  assert.match(migration, /gin_trgm_ops/)
  assert.doesNotMatch(migration.split('create or replace function public.influencers_set_search_text')[1].split('$$;')[0], /email/)
})
