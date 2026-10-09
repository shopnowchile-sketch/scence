// Pestañas de campaña personalizables: orden, ocultas y volver a agregar.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TAB_PREFS, dropTabBefore, moveTab, normalizeTabPrefs, resolveTabOrder, setTabHidden, visibleTabIds,
} from '../src/lib/campaign-tab-prefs.ts'

const ALL = ['overview', 'influencers', 'deliverables', 'billing', 'contracts', 'collaborators', 'history']

test('sin preferencias: orden y visibilidad por defecto', () => {
  assert.deepEqual(resolveTabOrder(ALL, DEFAULT_TAB_PREFS), ALL)
  assert.deepEqual(visibleTabIds(ALL, DEFAULT_TAB_PREFS, 'overview'), ALL)
})

test('mover: una posición a cada lado y sin salirse de los bordes', () => {
  assert.deepEqual(moveTab(ALL, 'history', -1).slice(-2), ['history', 'collaborators'])
  assert.deepEqual(moveTab(ALL, 'overview', -1), ALL)
  assert.deepEqual(moveTab(ALL, 'history', 1), ALL)
  assert.deepEqual(moveTab(ALL, 'no-existe', 1), ALL)
})

test('arrastrar: coloca la pestaña justo antes de la de destino', () => {
  assert.deepEqual(dropTabBefore(ALL, 'collaborators', 'influencers'), ['overview', 'collaborators', 'influencers', 'deliverables', 'billing', 'contracts', 'history'])
  assert.deepEqual(dropTabBefore(ALL, 'billing', 'billing'), ALL)
  assert.deepEqual(dropTabBefore(ALL, 'x', 'billing'), ALL)
})

test('ocultar y volver a agregar', () => {
  const hidden = setTabHidden(ALL, DEFAULT_TAB_PREFS, 'billing', true)
  assert.ok(!visibleTabIds(ALL, hidden, 'overview').includes('billing'))
  const shown = setTabHidden(ALL, hidden, 'billing', false)
  assert.ok(visibleTabIds(ALL, shown, 'overview').includes('billing'))
})

test('la pestaña de inicio nunca se oculta', () => {
  const p = setTabHidden(ALL, DEFAULT_TAB_PREFS, 'overview', true)
  assert.ok(visibleTabIds(ALL, p, 'history').includes('overview'))
  assert.deepEqual(normalizeTabPrefs({ order: ALL, hidden: ['overview', 'billing'] }).hidden, ['billing'])
})

test('la pestaña activa siempre se ve, aunque esté oculta (no se navega a algo invisible)', () => {
  const p = setTabHidden(ALL, DEFAULT_TAB_PREFS, 'billing', true)
  assert.ok(visibleTabIds(ALL, p, 'billing').includes('billing'))
  assert.ok(!visibleTabIds(ALL, p, 'history').includes('billing'))
})

test('pestañas nuevas se agregan al final; las que ya no existen se ignoran', () => {
  const prefs = { order: ['history', 'overview', 'viejaQueYaNoExiste'], hidden: ['otraVieja'] }
  const order = resolveTabOrder(ALL, prefs)
  assert.deepEqual(order.slice(0, 2), ['history', 'overview'])
  assert.ok(!order.includes('viejaQueYaNoExiste'))
  assert.equal(order.length, ALL.length)
  assert.deepEqual(new Set(order), new Set(ALL))
})

test('portal marca (menos pestañas): las preferencias de admin no rompen nada', () => {
  const brandTabs = ['overview', 'influencers', 'deliverables', 'billing', 'history']
  const adminPrefs = setTabHidden(ALL, moveTabs(), 'contracts', true)
  assert.deepEqual(new Set(resolveTabOrder(brandTabs, adminPrefs)), new Set(brandTabs))
  function moveTabs() { return { order: moveTab(ALL, 'collaborators', -1), hidden: [] as string[] } }
})

test('datos corruptos en localStorage se descartan sin lanzar', () => {
  for (const bad of [null, undefined, 5, 'x', [], { order: 'no', hidden: 3 }, { order: [1, 2], hidden: [null] }]) {
    assert.deepEqual(normalizeTabPrefs(bad), DEFAULT_TAB_PREFS)
  }
})
