'use client'

/**
 * PlanUpgradeWall — Bloqueador de feature por plan.
 * Muestra mensaje de límite alcanzado + CTA "Subir de plan".
 * El CTA enlaza a la selección de planes con Mercado Pago.
 */

import { Lock, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PLAN_LIMITS, getPlanTier, type PlanTier, formatPriceCLP } from '@/lib/plan-limits'

interface PlanUpgradeWallProps {
  /** Título del bloqueo. Ej: "Límite de campañas alcanzado" */
  title: string
  /** Descripción clara del límite. */
  description: string
  /** Plan actual (organizations.subscription_plan) */
  currentPlan: string
  /** Plan mínimo requerido para esta feature */
  requiredPlan?: PlanTier
  className?: string
}

export function PlanUpgradeWall({
  title,
  description,
  currentPlan,
  requiredPlan = 'growth',
  className,
}: PlanUpgradeWallProps) {
  const planInfo    = PLAN_LIMITS[requiredPlan]
  const currentTier = getPlanTier(currentPlan)

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center py-16 px-6',
      'bg-white rounded-2xl border border-violet-100',
      className,
    )}>
      {/* Icono */}
      <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mb-5">
        <Lock className="h-6 w-6 text-violet-500" />
      </div>

      {/* Texto */}
      <h2 className="text-lg font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-sm text-gray-500 max-w-sm mb-1">{description}</p>

      {/* Plan actual */}
      <p className="text-xs text-gray-400 mb-6">
        Tu plan actual:{' '}
        <span className="font-semibold capitalize text-gray-600">
          {PLAN_LIMITS[currentTier].label}
        </span>
      </p>

      {/* Plan recomendado */}
      <div className="bg-violet-50 border border-violet-100 rounded-xl px-5 py-4 mb-6 text-left w-full max-w-xs">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-violet-700 uppercase tracking-wide">
            Plan {planInfo.label}
          </span>
          <span className="text-sm font-bold text-violet-700">
            {formatPriceCLP(planInfo.price_monthly_clp)}/mes
          </span>
        </div>
        <ul className="space-y-1 mt-2">
          <li className="text-xs text-violet-600">
            ✓ {planInfo.max_active_campaigns >= 999
              ? 'Campañas ilimitadas'
              : `Hasta ${planInfo.max_active_campaigns} campañas activas`}
          </li>
          <li className="text-xs text-violet-600">
            ✓ {planInfo.max_roster_influencers >= 999
              ? 'Influencers ilimitados'
              : `Hasta ${planInfo.max_roster_influencers} influencers en roster`}
          </li>
          {planInfo.can_create_open_campaigns && (
            <li className="text-xs text-violet-600">✓ Campañas públicas y marketplace</li>
          )}
        </ul>
      </div>

      {/* CTA */}
      <Link
        href="/brand-settings/plan"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
      >
        Subir de plan
        <ArrowUpRight className="h-4 w-4" />
      </Link>

      <p className="text-xs text-gray-400 mt-3">
        Contáctanos y te ayudamos a migrar en minutos
      </p>
    </div>
  )
}
