// Selección masiva del listado de influencers (admin).
// Incidente 2026-10-04: con el filtro client-side "Sin Instagram" la página
// cargada traía 48 filas y se mostraban menos, pero "seleccionar todo" tomaba
// las 48. Así se borraron 96 fichas (2 páginas), 91 con Instagram.
// Regla: la selección masiva y las acciones masivas operan SOLO sobre lo visible.

/** "Seleccionar todo": alterna entre exactamente las filas visibles y nada. */
export function toggleAllVisible(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
  return allVisibleSelected ? new Set() : new Set(visibleIds)
}

/** Ids sobre los que actúa una acción masiva: seleccionados Y visibles. */
export function idsForBulkAction(selected: ReadonlySet<string>, visibleIds: readonly string[]): string[] {
  const visible = new Set(visibleIds)
  return Array.from(selected).filter(id => visible.has(id))
}
