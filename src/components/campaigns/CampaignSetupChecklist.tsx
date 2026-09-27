'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react'

type Props = { id: string }

type Campaign = {
  campaign_benefits?: unknown
  deliverable_templates?: unknown
  metadata?: unknown
  access_mode?: string | null
}

export function CampaignSetupChecklist({ id }: Props) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch(`/api/campaigns/${id}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setCampaign(json?.data ?? null) })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (loading || !campaign) return null

  const benefits = Array.isArray(campaign.campaign_benefits) ? campaign.campaign_benefits : []
  const deliverables = Array.isArray(campaign.deliverable_templates) ? campaign.deliverable_templates : []
  const items = [
    {
      label: 'Definir el canje',
      done: benefits.length > 0,
      href: `/admin-campaigns/${id}/edit?section=benefits`,
      description: benefits.length > 0 ? 'Canje configurado' : 'Qué recibe la influencer por participar',
    },
    {
      label: 'Definir los entregables',
      done: deliverables.length > 0,
      href: `/admin-campaigns/${id}/edit?section=deliverables`,
      description: deliverables.length > 0 ? `${deliverables.length} entregable${deliverables.length === 1 ? '' : 's'} configurado${deliverables.length === 1 ? '' : 's'}` : 'Qué contenido debe entregar la influencer',
    },
  ]

  const pending = items.filter(item => !item.done).length
  if (pending === 0) return null

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-semibold text-amber-950">Antes de publicar esta campaña</p>
          <p className="text-xs text-amber-800 mt-1">La campaña ya está creada. Completa lo más importante antes de activarla.</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-700">
          {pending} pendiente{pending === 1 ? '' : 's'}
        </span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <Link key={item.label} href={item.href}
            className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 hover:bg-amber-100/60 transition-colors">
            {item.done
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              : <Circle className="h-5 w-5 text-amber-500 shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-900">{item.label}</span>
              <span className="block text-xs text-gray-500 mt-0.5">{item.description}</span>
            </span>
            {!item.done && <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
          </Link>
        ))}
      </div>
    </div>
  )
}
