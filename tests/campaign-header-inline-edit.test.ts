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
  const expected: Record<string, number> = { 'Fecha': 1, 'Hora de inicio': 2, 'Hora de término': 2, 'Lugar': 1, 'Tipo de campaña': 1, 'Marca principal': 1, 'Nombre de campaña': 1 }
  for (const [label, n] of Object.entries(expected)) {
    assert.equal(count(new RegExp(`aria-label="${label}"`, 'g')), n, `aria-label="${label}"`)
  }
})

test('estado de la campaña: un único selector en el encabezado', () => {
  assert.equal(count(/title="Cambiar estado de la campaña"/g), 1)
})

test('los datos de lugar y fecha editados se guardan con el mismo estado de formulario de siempre', () => {
  assert.match(source, /value=\{summaryEditForm\.location\}/)
  assert.match(source, /setEventScheduleForm\(previous => previous\.map/)
  assert.match(source, /value=\{summaryEditForm\.type\}/)
})
