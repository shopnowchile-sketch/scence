import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverableTemplateTitle, publicDeliverableTemplates } from '../src/lib/deliverable-template-title.ts'

const REEL = '🎬 REEL ANTES DEL EVENTO\n\nCrear y publicar un reel anunciando que estás invitada a SCENCE Launch Experience...'
test('título = primera línea corta de la descripción (caso SCENCE Launch Experience)', () => {
  assert.equal(deliverableTemplateTitle({ type: 'reel', description: REEL }), '🎬 REEL ANTES DEL EVENTO')
  assert.equal(deliverableTemplateTitle({ type: 'event_attendance', description: 'Confirmar asistencia al evento' }), 'Confirmar asistencia al evento')
})
test('title explícito manda; descripción larga sin título o URL → nombre del tipo, nunca las instrucciones', () => {
  assert.equal(deliverableTemplateTitle({ type: 'reel', title: 'Reel lanzamiento', description: REEL }), 'Reel lanzamiento')
  assert.equal(deliverableTemplateTitle({ type: 'story', description: 'Crear y publicar historias anunciando que estás invitada a SCENCE Launch Experience, contando con entusiasmo' }), 'Historias')
  assert.equal(deliverableTemplateTitle({ type: 'other', description: 'https://www.instagram.com/p/De7FAnpmnwc/?img_index=1 REpost' }), 'Otro entregable')
})
test('versión pública: sin description, sin items; conserva tipo, cantidad y plazo', () => {
  const pub = publicDeliverableTemplates([{ type: 'reel', quantity: 2, description: REEL, due_date: '2026-11-05', items: [{ description: 'secreto' }] }])!
  assert.deepEqual(pub, [{ type: 'reel', quantity: 2, title: '🎬 REEL ANTES DEL EVENTO', due_date: '2026-11-05' }])
  assert.ok(!JSON.stringify(pub).includes('Crear y publicar'))
  assert.equal(publicDeliverableTemplates(null), null)
})
