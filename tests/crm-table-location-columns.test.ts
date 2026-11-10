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
  assert.match(src, /visibleColumns:v2/)
})

test('filtros de ubicación: catálogo Locations y Región/Comuna dependen del nivel anterior', () => {
  assert.match(src, /fetchNodes\('parent=root'\)/)
  assert.match(src, /disabled=\{!extra\.country\}/)
  assert.match(src, /!extra\.region && 'pointer-events-none/)
  assert.match(src, /setSelectedCommunes\(\[\]\)/)
})
