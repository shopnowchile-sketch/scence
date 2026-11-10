// Tabla CRM: País / Región / Comuna como columnas propias y filtros dependientes del catálogo `locations`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/app/(dashboard)/admin-crm/CrmLeadsClient.tsx', import.meta.url), 'utf8')

test('la columna genérica «Ubicación» se reemplazó por País, Región y Comuna ocultables', () => {
  assert.doesNotMatch(src, /key: 'location'/)
  for (const key of ['country', 'region', 'commune']) {
    assert.match(src, new RegExp(`key: '${key}', label:`))
    assert.match(src, new RegExp(`isColumnVisible\\('${key}'\\)`))
  }
  assert.match(src, /visibleColumns:v3/)
})

test('filtros de ubicación: solo valores que existen en los leads y dependientes del nivel anterior', () => {
  assert.doesNotMatch(src, /fetchNodes/)
  assert.match(src, /Object\.keys\(geo\)/)
  assert.match(src, /disabled=\{!extra\.country\}/)
  assert.match(src, /!extra\.region && 'pointer-events-none/)
  assert.match(src, /setSelectedCommunes\(\[\]\)/)
})

test('columnas ordenables, y columnas Tipo y Suscripción visibles', () => {
  for (const col of ['company_name', 'email', 'country', 'region', 'commune', 'source', 'qualification_status', 'contacted_at']) assert.match(src, new RegExp(`th\\('[^']+', '${col}'\\)`))
  assert.match(src, /isColumnVisible\('subscription'\)/)
  assert.match(src, /isColumnVisible\('type'\)/)
})

test('API: orden con lista cerrada, catálogo en cascada y suscripción desde email_optouts', () => {
  const api = readFileSync(new URL('../src/app/api/crm-leads/route.ts', import.meta.url), 'utf8')
  assert.match(api, /const SORTABLE = \[/)
  assert.match(api, /SORTABLE\.includes\(searchParams\.get\('sort'\)/)
  assert.match(api, /geo\[c\]\[g\]/)
  assert.match(api, /subscription: subscriptionOf\(l, optoutByEmail\)/)
  assert.match(api, /lead_type: leadTypeOf\(l\)/)
})

test('registrados en SCENCE (converted) no aparecen en el CRM pero no se borran', () => {
  const api = readFileSync(new URL('../src/app/api/crm-leads/route.ts', import.meta.url), 'utf8')
  assert.equal((api.match(/neq\('qualification_status', 'converted'\)/g) ?? []).length, 3, 'listado, ids_only y filtro')
  const link = readFileSync(new URL('../src/lib/crm-lead-link.ts', import.meta.url), 'utf8')
  assert.match(link, /qualification_status: 'converted'/)
  assert.doesNotMatch(link, /\.delete\(/)
})
