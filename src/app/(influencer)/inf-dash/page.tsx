'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Briefcase, Building2, Calendar,
  ChevronRight, LogOut, RefreshCw,
  CheckSquare, Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Campaign = {
  id: string
  status: string
  application_status: string | null
  fee: number | null
  currency: string
  campaign: {
    id: string
    name: string
    status: string
    start_date: string | null
    end_date: string | null
    brand: { name: string; logo_url: string | null } | null
  } | null
  campaign_deliverables: Array<{ id: string; status: string }>
}

type InfluencerProfile = {
  id: string
  display_name: string
  avatar_url: string | null
  email: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Estado a mostrar: la postulación (application_status) manda si sigue
// pendiente o fue rechazada; si no, se usa el estado real de la campaña.
type ResolvedStatus = 'postulada' | 'rechazada' | 'activa' | 'completada' | 'pausada' | 'borrador'

function resolveStatus(ci: Campaign): ResolvedStatus {
  if (ci.application_status === 'pending') return 'postulada'
  if (ci.application_status === 'rejected') return 'rechazada'
  const s = ci.campaign?.status
  if (s === 'completed') return 'completada'
  if (s === 'paused') return 'pausada'
  if (s === 'draft') return 'borrador'
  return 'activa'
}

const STATUS_CONFIG: Record<ResolvedStatus, { label: string; color: string }> = {
  postulada:  { label: 'Postulada · en revisión', color: 'bg-amber-100 text-amber-700' },
  rechazada:  { label: 'No seleccionada',         color: 'bg-gray-100 text-gray-500' },
  activa:     { label: 'Activa',                  color: 'bg-green-100 text-green-700' },
  completada: { label: 'Completada',               color: 'bg-blue-100 text-blue-700' },
  pausada:    { label: 'Pausada',                  color: 'bg-amber-100 text-amber-700' },
  borrador:   { label: 'Borrador',                 color: 'bg-gray-100 text-gray-500' },
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InfluencerDashboard() {
  const router  = useRouter()
  const [profile,   setProfile]   = useState<InfluencerProfile | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [meRes, campRes] = await Promise.all([
        fetch('/api/influencer/me'),
        fetch('/api/influencer/campaigns'),
      ])

      if (!meRes.ok) {
        const { error: e } = await meRes.json()
        setError(e ?? 'No se encontró tu perfil de influencer.')
        setLoading(false)
        return
      }

      const [meData, campData] = await Promise.all([meRes.json(), campRes.json()])
      setProfile(meData.data)
      setCampaigns(campData.data ?? [])
    } catch {
      setError('Error cargando tu dashboard. Intenta de nuevo.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-400">Cargando tu portal…</p>
        </div>
      </div>
    )
  }

  if (error && (error.includes('perfil de influencer') || error.includes('Not an influencer'))) {
    router.push('/')
    return null
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <button onClick={handleSignOut} className="btn-secondary text-sm flex items-center gap-2 mx-auto">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  const withStatus = campaigns.map(ci => ({ ci, status: resolveStatus(ci) }))
  const activasCount    = withStatus.filter(x => x.status === 'activa').length
  const postuladasCount = withStatus.filter(x => x.status === 'postulada').length
  const completadasCount = withStatus.filter(x => x.status === 'completada').length

  // Orden: activas y postuladas primero, completadas/rechazadas al final
  const ORDER: Record<ResolvedStatus, number> = {
    postulada: 0, activa: 0, pausada: 1, borrador: 1, completada: 2, rechazada: 3,
  }
  const sorted = [...withStatus].sort((a, b) => ORDER[a.status] - ORDER[b.status])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Hola, {profile?.display_name} 👋</h1>
            <p className="text-sm text-gray-400">{new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={handleSignOut} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conteo rápido */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
          <div className="text-xl font-bold text-gray-900">{activasCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">Activas</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
          <div className="text-xl font-bold text-gray-900">{postuladasCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">Postuladas</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
          <div className="text-xl font-bold text-gray-900">{completadasCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">Completadas</div>
        </div>
      </div>

      {/* Mis campañas */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
          <Briefcase className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-bold text-gray-900 flex-1">Mis campañas</h2>
        </div>
        <div className="px-5 py-4">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Briefcase className="h-8 w-8 text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">Todavía no tienes campañas.</p>
              <Link href="/inf-campaigns" className="mt-3 text-xs font-semibold text-violet-600 hover:underline">
                Ver campañas disponibles para postular →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map(({ ci, status }) => {
                const c = ci.campaign
                if (!c) return null
                const cfg = STATUS_CONFIG[status]
                const total = ci.campaign_deliverables?.length ?? 0
                const done  = ci.campaign_deliverables?.filter(d => d.status === 'approved' || d.status === 'published').length ?? 0
                return (
                  <button
                    key={ci.id}
                    onClick={() => router.push(`/inf-campaign/${c.id}`)}
                    className="w-full bg-gray-50 rounded-xl border border-gray-100 p-4 hover:border-violet-200 hover:shadow-sm transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {c.brand?.logo_url
                          ? <img src={c.brand.logo_url} alt={c.brand.name} className="w-9 h-9 object-contain" />
                          : <Building2 className="h-4 w-4 text-violet-300" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', cfg.color)}>
                            {cfg.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {c.brand?.name && <span className="text-xs text-violet-600 font-medium">{c.brand.name}</span>}
                          {(c.start_date || c.end_date) && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {fmt(c.start_date)}{c.end_date ? ` → ${fmt(c.end_date)}` : ''}
                            </span>
                          )}
                          {total > 0 && (
                            <span className="text-xs text-gray-400">{done}/{total} entregables</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Accesos rápidos al resto del portal */}
      <div className="flex items-center justify-around bg-white rounded-2xl border border-gray-100 py-3 px-4 text-xs">
        <Link href="/inf-tasks" className="flex items-center gap-1.5 text-gray-500 hover:text-violet-600 transition-colors">
          <CheckSquare className="h-3.5 w-3.5" /> Entregables
        </Link>
        <Link href="/inf-campaigns" className="flex items-center gap-1.5 text-gray-500 hover:text-violet-600 transition-colors">
          <Sparkles className="h-3.5 w-3.5" /> Campañas abiertas
        </Link>
        <Link href="/inf-bookings" className="flex items-center gap-1.5 text-gray-500 hover:text-violet-600 transition-colors">
          <Calendar className="h-3.5 w-3.5" /> Bookings
        </Link>
      </div>
    </div>
  )
}
