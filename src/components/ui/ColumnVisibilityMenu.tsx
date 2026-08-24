'use client'

import { useEffect, useRef, useState } from 'react'
import { Columns3, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Botón "Columnas" con dropdown de checkboxes para mostrar/ocultar columnas —
 * regla global pedida por Pri para todas las tablas (antes solo Campañas
 * tenía esto, cableado a mano dentro de CampaignsClient). Component-ized acá
 * para reusar en Marcas, Influencers, etc. sin duplicar el JSX.
 *
 * Uso:
 *   <ColumnVisibilityMenu
 *     columns={[{ key: 'industry', label: 'Industria' }, ...]}
 *     visible={visibleColumns}
 *     onToggle={toggleColumn}
 *     onReset={() => setVisibleColumns(DEFAULT_COLUMNS)}
 *   />
 */
export function ColumnVisibilityMenu<K extends string>({
  columns,
  visible,
  onToggle,
  onReset,
  iconOnly = false,
}: {
  columns: Array<{ key: K; label: string }>
  visible: Record<K, boolean>
  onToggle: (key: K) => void
  onReset?: () => void
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={iconOnly ? 'Columnas' : undefined}
        aria-label={iconOnly ? 'Columnas' : undefined}
        className={cn(
          'flex items-center rounded-xl border text-sm font-medium transition-colors',
          iconOnly ? 'p-2' : 'gap-1.5 px-3 py-2.5',
          open ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
        )}
      >
        <Columns3 className="h-4 w-4" />
        {!iconOnly && ' Columnas'}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-100 bg-white shadow-lg p-2">
          <div className="max-h-72 overflow-y-auto space-y-0.5">
            {columns.map(col => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={!!visible[col.key]}
                  onChange={() => onToggle(col.key)}
                  className="w-3.5 h-3.5 accent-violet-600"
                />
                {col.label}
              </label>
            ))}
          </div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="w-full flex items-center justify-center gap-1.5 mt-1 pt-2 border-t border-gray-50 text-xs text-gray-400 hover:text-gray-600 py-1.5"
            >
              <RotateCcw className="h-3 w-3" /> Restaurar por defecto
            </button>
          )}
        </div>
      )}
    </div>
  )
}
