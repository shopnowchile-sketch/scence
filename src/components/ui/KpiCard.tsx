import Link from 'next/link'
import type { ReactNode } from 'react'

// Tarjeta KPI compacta compartida por los dashboards de Admin, Marca e Influencer (solo presentación).
// Una sola fuente de estilo: padding, altura, ícono y tipografía se ajustan aquí, no en cada pantalla.
export type KpiTone = 'purple' | 'blue' | 'green' | 'red' | 'yellow' | 'gray'

const TONES: Record<KpiTone, string> = {
  purple: 'bg-purple-100 text-purple-600',
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-emerald-100 text-emerald-600',
  red: 'bg-rose-100 text-rose-600',
  yellow: 'bg-amber-100 text-amber-600',
  gray: 'bg-gray-100 text-gray-600',
}

/** Rejilla responsiva: móvil 2 por fila, tablet 3, escritorio 4. */
export function KpiGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 ${className}`.trim()}>{children}</div>
}

export function KpiCard({ icon, value, title, subtitle, tone, href }: {
  icon: ReactNode
  value: string
  title: string
  subtitle?: string
  tone: KpiTone
  href?: string
}) {
  const content = (
    <div className="flex items-center gap-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${TONES[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xl font-black leading-none tracking-tight text-gray-950">{value}</div>
        <div className="mt-1 truncate text-xs font-medium text-gray-500" title={title}>{title}</div>
        {subtitle && <div className="hidden truncate text-[11px] leading-tight text-gray-400 sm:block" title={subtitle}>{subtitle}</div>}
      </div>
    </div>
  )
  const base = 'block h-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm'
  return href
    ? <Link href={href} className={`${base} transition-all hover:border-purple-300 hover:shadow-md`}>{content}</Link>
    : <div className={base}>{content}</div>
}
