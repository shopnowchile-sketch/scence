'use client'

import { ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Encabezado de tabla clickeable para ordenar. Patrón único y reutilizable —
 * pedido por Pri: "cada vez que se agregue una columna nueva, siempre tengo
 * que poder ordenar por ella". Antes cada tabla tenía su propio <th> con o
 * sin sort cableado a mano (InfluencerTable tenía un TH local; el ranking no
 * tenía nada en el header, solo pills separados arriba).
 *
 * Uso:
 *   <SortableTH col="followers" sortBy={sortBy} sortDir={sortDir} onSort={setSort} align="right">
 *     Seguidores
 *   </SortableTH>
 *
 * Si no se pasa `col`, se renderiza como <th> normal (no clickeable) —
 * para columnas que genuinamente no tienen forma de ordenarse (ej. arrays
 * como Plataformas/Categorías).
 */
export function SortableTH<T extends string>({
  children,
  col,
  sortBy,
  sortDir,
  onSort,
  align = 'left',
  className,
}: {
  children: React.ReactNode
  col?: T
  sortBy?: T
  sortDir?: 'asc' | 'desc'
  onSort?: (col: T) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const sortable = !!col && !!onSort
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50',
        align === 'right' ? 'text-right' : 'text-left',
        sortable && 'cursor-pointer hover:text-gray-600 select-none',
        className
      )}
      onClick={() => sortable && onSort(col as T)}
    >
      <div className={cn('flex items-center gap-1', align === 'right' && 'justify-end')}>
        {children}
        {sortable && (
          <ArrowUpDown className={cn(
            'h-3 w-3 flex-shrink-0',
            sortBy === col ? 'text-violet-500' : 'text-gray-300'
          )} />
        )}
      </div>
    </th>
  )
}
