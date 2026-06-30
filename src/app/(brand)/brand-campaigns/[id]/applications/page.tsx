'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, Users,
  Instagram, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SocialProfile {
  platform: string
  username: string
  followers: number
  engagement_rate: number
  is_primary: boolean
}

interface Application {
  id: string
  application_status: string
  origin: string
  message: string | null
  fee: number | null
  deliverables_spec: Array<{ type: string; quantity: number; platform?: string; due_date?: string }>
  created_at: string
  influencer: {
    id: string
    display_name: string
    avatar_url: string | null
    bio: string | null
    categories: string[]
    city: string | null
    influencer_social_profiles: SocialProfile[]
  } | null
}

const STATUS = {
  pending:  { label: 'Pendiente',  color: 'bg-amber-100 text-amber-700',  icon: Clock },
  accepted: { label: 'Aceptado',   color: 'bg-green-100 text-green-700',  icon: CheckCircle2 },
  rejected: { label: 'Rechazado',  color: 'bg-red-100 text-red-700',     icon: XCircle },
  expired:  { label: 'Expirado',   color: 'bg-gray-100 text-gray-500',   icon: Clock },
  withdrawn:{ label: 'Retirado',   color: 'bg-gray-100 text-gray-500',   icon: Clock },
}

function fmtFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

function fmtCLP(n: number | null) {
  if (!n) return null
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

export default function ApplicationsPage() {
  const { id: campaignId } = useParams<{ id: string }>()
  const router = useRouter()

  const [apps, setApps]           = useState<Application[]>([])
  const [visibility, setVisibility] = useState('')
  const [loading, setLoading]     = useState(true)
  const [acting, setActing]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brand-campaigns/${campaignId}/applications`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setApps(json.data ?? [])
      setVisibility(json.visibility ?? '')
    } catch (e) {
      toast.error((e as Error).message)
    }
    setLoading(false)
  }, [campaignId])

  useEffect(() => { load() }, [load])

  async function decide(applicationId: string, action: 'accept' | 'reject') {
    setActing(applicationId)
    try {
      const res = await fetch(`/api/brand-campaigns/${campaignId}/applications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId, action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'accept' ? '✅ Influencer aceptado' : '❌ Rechazado')
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActing(null)
  }

  const pending  = apps.filter(a => a.application_status === 'pending')
  const resolved = apps.filter(a => a.application_status !== 'pending')

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <button onClick={() => router.push(`/brand-campaigns/${campaignId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Volver a la campaña
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {visibility === 'open' ? 'Postulaciones' : 'Invitaciones'}
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {pending.length} pendiente(s) · {resolved.length} gestionada(s)
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/brand-influencers?campaignId=${campaignId}`)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-sm font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Users className="h-4 w-4" /> Invitar más
            </button>
          </div>
        </div>
      </div>

      {apps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center py-20 text-center">
          <Users className="h-12 w-12 text-gray-200 mb-4" />
          <p className="text-gray-500 font-medium">
            {visibility === 'open' ? 'Aún no hay postulaciones' : 'Aún no hay invitaciones enviadas'}
          </p>
          <button
            onClick={() => router.push(`/brand-influencers?campaignId=${campaignId}`)}
            className="mt-4 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            Invitar influencers
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pendientes */}
          {pending.length > 0 && (
            <div>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Pendientes ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(app => {
                  const inf = app.influencer
                  const primary = inf?.influencer_social_profiles?.find(p => p.is_primary)
                    ?? inf?.influencer_social_profiles?.[0]
                  const isActing = acting === app.id

                  return (
                    <div key={app.id} className="bg-white rounded-2xl border border-amber-100 p-5 space-y-4">
                      <div className="flex items-start gap-3">
                        {inf?.avatar_url
                          ? <img src={inf.avatar_url} alt={inf.display_name} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white font-bold flex-shrink-0">{inf?.display_name?.[0] ?? '?'}</div>
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-900">{inf?.display_name ?? 'Sin nombre'}</h3>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              {app.origin === 'application' ? 'Postulación' : 'Invitación'}
                            </span>
                          </div>
                          {primary && (
                            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                              <Instagram className="h-3 w-3" />
                              @{primary.username} · {fmtFollowers(primary.followers)}
                            </p>
                          )}
                          {inf?.categories?.length ? (
                            <div className="flex gap-1 mt-1">
                              {inf.categories.slice(0, 3).map(c => (
                                <span key={c} className="text-[10px] capitalize bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{c}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {app.fee && (
                          <span className="text-sm font-bold text-gray-700 flex-shrink-0">{fmtCLP(app.fee)}</span>
                        )}
                      </div>

                      {app.message && (
                        <div className="bg-gray-50 rounded-xl px-4 py-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1">Mensaje</p>
                          <p className="text-sm text-gray-700">{app.message}</p>
                        </div>
                      )}

                      {app.deliverables_spec?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-1.5">Entregables</p>
                          <div className="flex flex-wrap gap-1.5">
                            {app.deliverables_spec.map((d, i) => (
                              <span key={i} className="text-xs bg-violet-50 text-violet-700 px-2 py-1 rounded-lg">
                                {d.quantity}× {d.type.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => decide(app.id, 'reject')}
                          disabled={isActing}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-red-200 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                          Rechazar
                        </button>
                        <button
                          onClick={() => decide(app.id, 'accept')}
                          disabled={isActing}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Aceptar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Resueltas */}
          {resolved.length > 0 && (
            <div>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Gestionadas ({resolved.length})
              </h2>
              <div className="space-y-2">
                {resolved.map(app => {
                  const inf = app.influencer
                  const cfg = STATUS[app.application_status as keyof typeof STATUS] ?? STATUS.pending
                  const Icon = cfg.icon

                  return (
                    <div key={app.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-3">
                      {inf?.avatar_url
                        ? <img src={inf.avatar_url} alt={inf?.display_name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                        : <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-bold flex-shrink-0">{inf?.display_name?.[0] ?? '?'}</div>
                      }
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-gray-800">{inf?.display_name ?? '—'}</span>
                        <span className="text-xs text-gray-400 ml-2">{app.origin === 'application' ? 'Postulación' : 'Invitación'}</span>
                      </div>
                      <span className={cn('flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full', cfg.color)}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
