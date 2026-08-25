'use client'

import { Languages } from 'lucide-react'
import { useScenceLocale } from '@/components/providers/LocaleProvider'
import { cn } from '@/lib/utils'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useScenceLocale()

  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-gray-600',
        compact ? 'px-2 py-1' : 'px-2.5 py-1.5 shadow-sm',
      )}
      title={locale === 'es' ? 'Cambiar idioma' : 'Change language'}
      data-no-translate
    >
      <Languages className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
      <select
        value={locale}
        onChange={event => setLocale(event.target.value as 'es' | 'en')}
        className="cursor-pointer bg-transparent text-xs font-semibold outline-none"
        aria-label={locale === 'es' ? 'Idioma' : 'Language'}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </label>
  )
}
