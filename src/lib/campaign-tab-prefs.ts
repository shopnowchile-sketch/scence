// Preferencias de las pestañas del detalle de campaña: orden y pestañas ocultas.
// Lógica pura (sin React) para poder probarla. La preferencia se guarda por navegador
// (useLocalStorageState); `order` es el orden COMPLETO (visibles + ocultas) y `hidden` el subconjunto oculto.

export interface TabPrefs { order: string[]; hidden: string[] }

/** La pestaña de inicio nunca se oculta: es el destino por defecto y el respaldo de navegación. */
export const PINNED_TAB = 'overview'

export const DEFAULT_TAB_PREFS: TabPrefs = { order: [], hidden: [] }

/** Valida lo que venga de localStorage (puede estar corrupto o de una versión anterior). */
export function normalizeTabPrefs(raw: unknown): TabPrefs {
  const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  if (!raw || typeof raw !== 'object') return DEFAULT_TAB_PREFS
  const r = raw as Record<string, unknown>
  return { order: Array.from(new Set(list(r.order))), hidden: Array.from(new Set(list(r.hidden))).filter(id => id !== PINNED_TAB) }
}

/** Orden completo: lo guardado (solo ids que existen hoy) + las pestañas nuevas al final, en su orden por defecto. */
export function resolveTabOrder(allIds: string[], prefs: TabPrefs): string[] {
  const known = new Set(allIds)
  const saved = prefs.order.filter(id => known.has(id))
  const seen = new Set(saved)
  return [...saved, ...allIds.filter(id => !seen.has(id))]
}

/** Pestañas visibles en la barra. La pestaña activa se muestra siempre, aunque esté oculta, para no navegar a algo invisible. */
export function visibleTabIds(allIds: string[], prefs: TabPrefs, activeId?: string): string[] {
  const hidden = new Set(prefs.hidden.filter(id => id !== PINNED_TAB))
  return resolveTabOrder(allIds, prefs).filter(id => !hidden.has(id) || id === activeId)
}

/** Mueve una pestaña una posición hacia la izquierda (-1) o la derecha (+1) dentro del orden completo. */
export function moveTab(order: string[], id: string, dir: -1 | 1): string[] {
  const from = order.indexOf(id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Arrastrar: coloca `dragId` justo antes de `targetId`. */
export function dropTabBefore(order: string[], dragId: string, targetId: string): string[] {
  if (dragId === targetId || !order.includes(dragId) || !order.includes(targetId)) return order
  const without = order.filter(id => id !== dragId)
  const at = without.indexOf(targetId)
  return [...without.slice(0, at), dragId, ...without.slice(at)]
}

/** Oculta o vuelve a mostrar una pestaña. Guarda además el orden completo actual. */
export function setTabHidden(allIds: string[], prefs: TabPrefs, id: string, hide: boolean): TabPrefs {
  const order = resolveTabOrder(allIds, prefs)
  if (id === PINNED_TAB || !order.includes(id)) return { order, hidden: prefs.hidden.filter(h => h !== PINNED_TAB) }
  const hidden = new Set(prefs.hidden)
  if (hide) hidden.add(id); else hidden.delete(id)
  return { order, hidden: Array.from(hidden) }
}
