'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CheckCircle2, ChevronRight, Compass, Loader2, RotateCcw, X } from 'lucide-react'

type OnboardingData = {
  organization_complete: boolean
  nda_signed: boolean
  first_campaign_id: string | null
  state: { skipped_at?: string; campaign_tour_seen?: boolean }
}

type Step = {
  id: 'organization' | 'nda' | 'campaign' | 'tour'
  title: string
  description: string
  href?: string
  complete: boolean
}

async function updateOnboarding(action: 'skip' | 'complete_campaign_tour' | 'restart') {
  const response = await fetch('/api/brand/onboarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!response.ok) throw new Error('No se pudo actualizar la guía')
  return response.json()
}

export function BrandOnboarding() {
  const pathname = usePathname()
  const router = useRouter()
  const [data, setData] = useState<OnboardingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)

  const load = async () => {
    try {
      const response = await fetch('/api/brand/onboarding', { cache: 'no-store' })
      const json = await response.json()
      if (response.ok) setData(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [pathname])

  const steps = useMemo<Step[]>(() => {
    if (!data) return []
    return [
      {
        id: 'organization',
        title: 'Completa tu organización',
        description: 'Agrega datos legales, contacto, Instagram y dirección.',
        href: '/brand-settings/organization',
        complete: data.organization_complete,
      },
      {
        id: 'nda',
        title: 'Firma el NDA',
        description: 'Necesitamos el acuerdo firmado antes de abrir influencers.',
        href: '/brand-documents',
        complete: data.nda_signed,
      },
      {
        id: 'campaign',
        title: 'Crea tu primera campaña',
        description: 'Define el objetivo, fechas y a quién quieres invitar.',
        href: '/brand-campaigns',
        complete: Boolean(data.first_campaign_id),
      },
      {
        id: 'tour',
        title: 'Conoce tu campaña',
        description: 'Overview resume todo; Influencers, Deliverables, Canjes y Assets ordenan la ejecución.',
        href: data.first_campaign_id ? `/brand-campaigns/${data.first_campaign_id}` : undefined,
        complete: Boolean(data.state.campaign_tour_seen),
      },
    ]
  }, [data])

  const current = steps.find(step => !step.complete)
  const allDone = steps.length > 0 && !current
  const isOnCampaign = Boolean(data?.first_campaign_id && pathname.startsWith(`/brand-campaigns/${data.first_campaign_id}`))

  if (loading || hidden || !data || data.state.skipped_at) return null

  const dismiss = async () => {
    setHidden(true)
    try { await updateOnboarding('skip') } catch { setHidden(false) }
  }

  const completeTour = async () => {
    setHidden(true)
    try { await updateOnboarding('complete_campaign_tour'); await load() } catch { setHidden(false) }
  }

  if (allDone) return (
    <button onClick={() => void updateOnboarding('restart').then(load)} className="fixed bottom-5 right-5 z-40 hidden items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 shadow-lg hover:bg-violet-50 lg:inline-flex">
      <RotateCcw className="h-3.5 w-3.5" /> Ver guía inicial
    </button>
  )

  if (!current) return null

  return (
    <aside className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-violet-100 bg-white p-4 shadow-xl shadow-violet-950/10 lg:bottom-6 lg:right-6" aria-label="Guía de inicio">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5"><span className="mt-0.5 rounded-lg bg-violet-100 p-2 text-violet-700"><Compass className="h-4 w-4" /></span><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Guía de inicio · {steps.filter(step => step.complete).length + 1}/{steps.length}</p><h2 className="mt-0.5 text-sm font-bold text-gray-900">{current.title}</h2></div></div>
        <button type="button" onClick={() => void dismiss()} className="text-gray-400 hover:text-gray-600" aria-label="Omitir guía"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-2 text-sm leading-5 text-gray-500">{current.description}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => void dismiss()} className="text-xs font-medium text-gray-500 hover:text-gray-700">Omitir guía</button>
        {current.id === 'tour' && isOnCampaign ? (
          <button type="button" onClick={() => void completeTour()} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700"><CheckCircle2 className="h-3.5 w-3.5" />Entendido</button>
        ) : current.href ? (
          <button type="button" onClick={() => router.push(current.href!)} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">Ir al paso <ChevronRight className="h-3.5 w-3.5" /></button>
        ) : <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Esperando campaña</span>}
      </div>
    </aside>
  )
}
