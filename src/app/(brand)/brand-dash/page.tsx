'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Target, CheckCircle2, Clock, AlertCircle,
  TrendingUp, Users, Calendar, ChevronRight, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type DeliverableStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'published'

interface Deliverable {
  id: string
  title: string
  type: string
  status: DeliverableStatus
  due_date: string | null
  content_url: string | null
  submitted_at: string | null
  influencer: { id: string; display_name: string; avatar_url: string | null } | null
}

interface Campaign {
  id: string
  name: string
  status: string
  start_date: string | null
  end_date: string | null
  budget_total: number | null
  currency: string
  campaign_influencers: Array<{ id: string; status: string; influencer: { id: string; display_name: string; avatar_url: string | null } | null }>
  campaign_deliverables: Deliverable[]
}

interface Brand {
  id: string
  name: string
  logo_url: string | null
  contact_name: string | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:            { label: 'Borrador',    color: 'bg-gray-100 text-gray-600',   icon: Clock },
  active:           { label: 'Activa',      color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  pending_approval: { label: 'En revisión', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
  paused:           { label: 'Pausada',     color: 'bg-orange-100 text-orange-700', icon: Clock },
  completed:        { label: 'Completada',  color: 'bg-blue-100 text-blue-700',   icon: CheckCircle2 },
  canceled:         { label: 'Cancelada',   color: 'bg-red-100 text-red-700',     icon: AlertCircle },
}

const DEL_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pendiente',    color: 'bg-gray-100 text-gray-600' },
  in_review: { label: 'Para revisar', color: 'bg-amber-100 text-amber-700' },
  approved:  { label: 'Aprobado',     color: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Rechazado',    color: 'bg-red-100 text-red-700' },
  published: { label: 'Publicado',    color: 'bg-violet-100 text-violet-700' },
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BrandDashboard() {
  const [brand, setBrand]         = useState<Brand | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brand/campaigns')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCampaigns(json.data ?? [])
      setBrand(json.brand ?? null)
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando campañas')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const activeCampaigns   = campaigns.filter(c => c.status === 'active')
  const pendingDeliverables = campaigns.flatMap(c =>
    c.campaign_deliverables.filter(d => d.status === 'in_review')
  )
  const totalInfluencers = new Set(
    campaigns.flatMap(c => c.campaign_influencers.map(ci => ci.influencer?.id)).filter(Boolean)
  ).size

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {brand ? `Hola, ${brand.contact_name ?? brand.name}` : 'Portal de Marca'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Resumen de tus campañas</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Campañas activas', value: activeCampaigns.length, icon: Target, color: 'text-violet-600', bg: 'bg-violet-50' },
          { label: 'Influencers',      value: totalInfluencers,        icon: Users,  color: 'text-blue-600',   bg: 'bg-blue-50' },
          { label: 'Para revisar',     value: pendingDeliverables.length, icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', bg)}>
              <Icon className={cn('h-5 w-5', color)} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Contenido para revisar */}
      {pendingDeliverables.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-amber-800 mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {pendingDeliverables.length} contenido(s) esperando tu revisión
          </h2>
          <div className="space-y-2">
            {pendingDeliverables.slice(0, 3).map(d => {
              const camp = campaigns.find(c => c.campaign_deliverables.some(x => x.id === d.id))
              return (
                <Link
                  key={d.id}
                  href={`/brand-campaigns/${camp?.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 hover:shadow-sm transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{d.title || d.type}</p>
                    <p className="text-xs text-gray-500">{d.influencer?.display_name} · {camp?.name}</p>
                  </div>
                  {d.content_url && (
                    <a href={d.content_url} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-violet-600 hover:underline flex-shrink-0">
                      Ver contenido
                    </a>
                  )}
                  <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                </Link>
              )
            })}
            {pendingDeliverables.length > 3 && (
              <p className="text-xs text-amber-700 text-center pt-1">
                +{pendingDeliverables.length - 3} más — ve a cada campaña para revisar
              </p>
            )}
          </div>
        </div>
      )}

      {/* Lista de campañas */}
      <div>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Tus Campañas</h2>
        {campaigns.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-16">
            <Target className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">No tienes campañas asignadas aún.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft
              const StatusIcon = cfg.icon
              const delTotal  = c.campaign_deliverables.length
              const delDone   = c.campaign_deliverables.filter(d => d.status === 'approved' || d.status === 'published').length
              const delReview = c.campaign_deliverables.filter(d => d.status === 'in_review').length
              const pct = delTotal > 0 ? Math.round((delDone / delTotal) * 100) : 0

              return (
                <Link
                  key={c.id}
                  href={`/brand-campaigns/${c.id}`}
                  className="block bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{c.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {fmt(c.start_date)} → {fmt(c.end_date)}</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.campaign_influencers.length} influencer(s)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {delReview > 0 && (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                          {delReview} para revisar
                        </span>
                      )}
                      <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1', cfg.color)}>
                        <StatusIcon className="h-3 w-3" /> {cfg.label}
                      </span>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  {delTotal > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {pct}% completado</span>
                        <span>{delDone}/{delTotal} entregables</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
