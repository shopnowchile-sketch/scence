'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Circle, ChevronRight } from 'lucide-react'

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

  const pendingItems = items.filter(item => !item.done)

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 shrink-0">Falta completar:</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {pendingItems.map(item => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:border-violet-300 hover:text-violet-700 transition-colors"
            >
              <Circle className="h-3 w-3 text-amber-500" />
              {item.label.replace('Definir el ', '').replace('Definir los ', '')}
              <ChevronRight className="h-3 w-3 text-gray-400" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
