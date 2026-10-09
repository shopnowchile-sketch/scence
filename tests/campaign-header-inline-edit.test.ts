// Encabezado de campaña: al editar, los MISMOS campos pasan a ser editables en su lugar.
// No debe reaparecer un segundo bloque de edición duplicado debajo del título.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/app/(dashboard)/admin-campaigns/[id]/CampaignDetail.tsx', import.meta.url), 'utf8')
const count = (re: RegExp) => (source.match(re) ?? []).length

test('no existe el bloque duplicado de edición del encabezado', () => {
  assert.equal(count(/<div className="mt-2 space-y-3">/g), 0)
})

test('cada campo editable del encabezado aparece una sola vez (en su lugar)', () => {
  // Las horas también existen en el pequeño editor previo de "Hora por confirmar" (estado excluyente, sin horario agendado).
  const expected: Record<string, number> = { 'Fecha': 1, 'Hora de inicio': 2, 'Hora de término': 2, 'Tipo de campaña': 1, 'Marca principal': 1, 'Nombre de campaña': 1 }
  for (const [label, n] of Object.entries(expected)) {
    assert.equal(count(new RegExp(`aria-label="${label}"`, 'g')), n, `aria-label="${label}"`)
  }
})

test('estado de la campaña: un único selector en el encabezado', () => {
  assert.equal(count(/title="Cambiar estado de la campaña"/g), 1)
})

test('los datos de lugar y fecha editados se guardan con el mismo estado de formulario de siempre', () => {
  // El lugar ya no es un campo de texto del resumen: se edita con las direcciones canónicas (campaign_locations).
  assert.match(source, /<CampaignLocationsEditor campaignId=\{id\}/)
  assert.doesNotMatch(source, /summaryEditForm\.location\b/)
  assert.match(source, /setEventScheduleForm\(previous => previous\.map/)
  assert.match(source, /value=\{summaryEditForm\.type\}/)
})

test('no queda el editor de evento muerto (nunca se abría desde ningún botón)', () => {
  for (const dead of ['editingEvent', 'openEventEditor', 'setEventForm', 'saveEvent(']) {
    assert.equal(source.includes(dead), false, `no debe existir ${dead}`)
  }
})

test('barra superior: Editar campaña / Cancelar / Guardar cambios y menú de acciones', () => {
  for (const text of ['Editar campaña', 'Guardar cambios', 'Duplicar como borrador', 'Reporte PDF', 'Pausar campaña', 'Cancelar campaña', 'Borrar todo (permanente)']) {
    assert.ok(source.includes(text), `falta "${text}"`)
  }
  assert.equal(count(/title="Editar resumen de campaña"/g), 0, 'el lápiz diminuto junto a la marca ya no existe')
})

test('acciones destructivas solo para el portal admin (no marca)', () => {
  const idx = source.indexOf('Borrar todo (permanente)')
  const before = source.slice(Math.max(0, idx - 1800), idx)
  assert.match(before, /!isBrandPortal && \(/)
})

test('el lugar no repite partes iguales', () => {
  assert.match(source, /Array\.from\(new Set\(\[eventVenueName, eventLocation, eventCommune\]/)
})

test('barra superior solo con iconos: cada botón lleva aria-label y tooltip, sin texto visible', () => {
  const start = source.indexOf('{/* Barra superior')
  const end = source.indexOf('{/* Resumen del evento')
  const bar = source.slice(start, end)
  for (const label of ['Cancelar edición', 'Guardar cambios', 'Editar campaña', 'Marcar campaña como completada', 'Reabrir campaña', 'Más acciones']) {
    assert.match(bar, new RegExp(`aria-label="${label}"`), `falta aria-label="${label}"`)
  }
  // Los textos de antes ya no son contenido visible de los botones
  assert.doesNotMatch(bar, />\s*Editar campaña\s*</)
  assert.doesNotMatch(bar, />\s*Guardar cambios\s*</)
  assert.doesNotMatch(bar, />\s*Completar\s*</)
  // El menú ⋯ conserva texto: sin palabras no se distinguiría Cancelar de Borrar todo
  assert.match(bar, /Borrar todo \(permanente\)/)
})
