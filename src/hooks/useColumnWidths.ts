'use client'

import { useCallback, useRef } from 'react'
import { useLocalStorageState } from './useLocalStorageState'

const MIN_WIDTH = 60

/**
 * Anchos de columna ajustables por el usuario (drag del borde derecho del
 * header), persistidos en localStorage — regla global pedida por Pri para
 * todas las tablas (Marcas, Influencers, etc.), igual criterio que
 * useLocalStorageState ya usa para columnas visibles y sort.
 *
 * Uso:
 *   const { widths, startResize } = useColumnWidths('scence:admin:brands:widths', { name: 220, status: 120 })
 *   <col style={{ width: widths.name }} />
 *   <SortableTH col="name" ... onResizeStart={e => startResize('name', e)}>Marca</SortableTH>
 */
export function useColumnWidths<K extends string>(storageKey: string, defaults: Record<K, number>) {
  const [widths, setWidths] = useLocalStorageState<Record<K, number>>(storageKey, defaults)
  const drag = useRef<{ col: K; startX: number; startWidth: number } | null>(null)

  const startResize = useCallback((col: K, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { col, startX: e.clientX, startWidth: widths[col] ?? defaults[col] ?? 150 }

    function onMove(ev: MouseEvent) {
      if (!drag.current) return
      const delta = ev.clientX - drag.current.startX
      const next = Math.max(MIN_WIDTH, Math.round(drag.current.startWidth + delta))
      setWidths(prev => ({ ...prev, [drag.current!.col]: next }))
    }
    function onUp() {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [widths, defaults, setWidths])

  const resetWidths = useCallback(() => setWidths(defaults), [defaults, setWidths])

  return { widths, startResize, resetWidths }
}
