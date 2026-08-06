'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Rating de 1 a 5 estrellas, clickeable. Pedido por Pri para calificar
 * contenido entregado (campaign_deliverables.content_rating) y poder filtrar
 * después por calidad. Reutilizable — no es específico de deliverables.
 */
export function StarRating({
  value,
  onChange,
  size = 'sm',
  disabled,
}: {
  value: number | null | undefined
  onChange: (rating: number) => void
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  // La campaña es la única fuente de verdad. `useDeliverableAction` actualiza
  // esa caché de forma optimista antes de enviar el PATCH, por lo que el valor
  // cambia inmediatamente y queda sincronizado con el dato que se guarda.
  const display = hover ?? value ?? 0
  const dim = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={e => {
            e.stopPropagation()
            onChange(n)
          }}
          onMouseEnter={() => setHover(n)}
          className="disabled:cursor-not-allowed"
          title={`${n} estrella${n !== 1 ? 's' : ''}`}
        >
          <Star className={cn(
            dim,
            n <= display ? 'text-amber-400 fill-amber-400' : 'text-gray-200',
            !disabled && 'hover:text-amber-300 transition-colors'
          )} />
        </button>
      ))}
    </div>
  )
}
