'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Calendar,
  LogOut, RefreshCw,
  CheckSquare, Sparkles, Instagram, AlertCircle,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
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
  campaign_deliverables: Array<{ id: string; status: string; content_url: string | null; published_url: string | null }>
}

// Mismo shape que /inf-campaigns/page.tsx (OpenCampaign) — reutiliza el
// mismo endpoint /api/influencer/campaigns/open, no se toca el backend.
type OpenCampaign = {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  brand: { id: string; name: string; logo_url: string | null } | null
  _applied?: boolean
}

type SocialProfile = {
  id: string
  platform: string
  username: string | null
  profile_url: string | null
}

type InfluencerProfile = {
  id: string
  display_name: string
  avatar_url: string | null
  email: string | null
  influencer_social_profiles?: SocialProfile[]
}

function hasInstagram(profile: InfluencerProfile | null) {
  return Boolean(
    profile?.influencer_social_profiles?.some(
      sp => sp.platform === 'instagram' && (sp.username || sp.profile_url)
    )
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function InfluencerDashboard() {
  const router  = useRouter()
  const [profile,   setProfile]   = useState<InfluencerProfile | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [openCampaigns, setOpenCampaigns] = useState<OpenCampaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [igInput,   setIgInput]   = useState('')
  const [igSaving,  setIgSaving]  = useState(false)
  const [igError,   setIgError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // /api/influencer/campaigns/open se resuelve aparte (Promise.allSettled)
      // para que si falla no tumbe el resto del dashboard — mismo criterio
      // defensivo que ya usa /inf-campaigns/page.tsx para este mismo fetch.
      const [meRes, campRes, openResult] = await Promise.all([
        fetch('/api/influencer/me'),
        fetch('/api/influencer/campaigns'),
        fetch('/api/influencer/campaigns/open').then(
          async r => (r.ok ? ((await r.json()).data ?? []) : []),
        ).catch(() => []),
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
      setOpenCampaigns(openResult as OpenCampaign[])
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

  async function handleSaveInstagram() {
    const raw = igInput.trim()
    if (!raw) { setIgError('Ingresa tu usuario de Instagram.'); return }
    const username = raw.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '').split('?')[0]
    if (!username) { setIgError('Usuario de Instagram inválido.'); return }

    setIgSaving(true)
    setIgError(null)
    try {
      const res = await fetch('/api/influencer/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          social_profiles: [{ platform: 'instagram', username, profile_url: `https://instagram.com/${username}` }],
        }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        setIgError(e ?? 'No se pudo guardar. Intenta de nuevo.')
        setIgSaving(false)
        return
      }
      await load()
    } catch {
      setIgError('Error de conexión. Intenta de nuevo.')
    }
    setIgSaving(false)
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

  // Gate: sin Instagram no puede avanzar en el portal.
  if (profile && !hasInstagram(profile)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-pink-50 flex items-center justify-center mx-auto mb-4">
            <Instagram className="h-6 w-6 text-pink-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Falta tu Instagram</h1>
          <p className="text-sm text-gray-400 mt-1 mb-5">
            Para continuar en el portal necesitamos al menos tu usuario de Instagram.
          </p>
          <input
            value={igInput}
            onChange={e => setIgInput(e.target.value)}
            placeholder="@tuusuario"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-center outline-none focus:border-violet-400 mb-3"
          />
          {igError && (
            <p className="text-xs text-red-500 flex items-center justify-center gap-1 mb-3">
              <AlertCircle className="h-3.5 w-3.5" /> {igError}
            </p>
          )}
          <button
            onClick={handleSaveInstagram}
            disabled={igSaving}
            className="btn-primary w-full text-sm justify-center disabled:opacity-60"
          >
            {igSaving ? 'Guardando…' : 'Guardar y continuar'}
          </button>
          <button onClick={handleSignOut} className="mt-3 text-xs text-gray-400 hover:text-gray-600">
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  const withStatus = campaigns.map(ci => ({ ci, status: resolveStatus(ci) }))
  const activasCount    = withStatus.filter(x => x.status === 'activa').length
  const postuladasCount = withStatus.filter(x => x.status === 'postulada').length
  const completadasCount = withStatus.filter(x => x.status === 'completada').length

  // % de entregables pendientes sobre el total, sumando TODAS las campañas
  // asignadas (no por campaña) — mismo dato ya cargado (campaign_deliverables
  // via /api/influencer/campaigns), sin fetch nuevo.
  const allDeliverables = campaigns.flatMap(ci => ci.campaign_deliverables ?? [])
  const totalDeliverables = allDeliverables.length
  // Mismo criterio de "completado" que el resto de la app (ver activeCampaigns
  // más abajo y CampaignDetail.tsx en admin): URL subida o status aprobado/
  // completado/publicado. Antes solo miraba status, así que un entregable ya
  // entregado pero todavía 'pending'/'in_review' contaba como pendiente.
  const pendingDeliverablesCount = allDeliverables.filter(d =>
    !d.content_url && !d.published_url && !['approved', 'completed', 'published'].includes(d.status)
  ).length
  const pendingPct = totalDeliverables > 0 ? Math.round((pendingDeliverablesCount / totalDeliverables) * 100) : 0

  const gaugeData = [
    { name: 'Pendiente',  value: pendingDeliverablesCount,               color: '#7c3aed' },
    { name: 'Completado', value: totalDeliverables - pendingDeliverablesCount, color: '#e5e7eb' },
  ]

  // Disponibles para postular, sin las que ya postuló (esas se ven en
  // /inf-campaigns como "En revisión" — mismo criterio que ya usa esa
  // página, acá solo se filtra en el cliente sobre el mismo endpoint).
  const availableCampaigns = openCampaigns.filter(c => !c._applied)

  // Campañas activas con su % de entregables completados — pedido: verlas
  // en el dashboard (no solo el conteo agregado del gauge). Al 100% no pasa
  // nada al hacer clic (ya no hay nada pendiente que subir); con menos de
  // 100% lleva directo a los entregables de ESA campaña en /inf-tasks.
  const activeCampaigns = withStatus
    .filter(x => x.status === 'activa' && x.ci.campaign?.id)
    .map(x => {
      const delivs = x.ci.campaign_deliverables ?? []
      const total  = delivs.length
      // Mismo criterio de "completado" que el resumen de campaña en admin
      // (CampaignDetail.tsx): tiene URL subida O status aprobado/completado/
      // publicado — antes solo miraba status === 'approved'/'published', por
      // lo que un entregable ya subido pero aún 'pending'/'in_review' contaba
      // como 0%, mostrando 0% aunque la influencer ya hubiera entregado todo.
      const done   = delivs.filter(d =>
        !!d.content_url || !!d.published_url || ['approved', 'completed', 'published'].includes(d.status)
      ).length
      const pct    = total > 0 ? Math.round((done / total) * 100) : 0
      return { ci: x.ci, pct, total }
    })

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

      {/* Fila 1: Activas / Postuladas / gauge — KPI + gráfico siempre juntos
          arriba, todos clickeables a su listado correspondiente. */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => router.push('/inf-campaigns')}
          className="bg-white rounded-2xl border border-gray-100 p-4 text-center hover:border-violet-200 transition-colors"
        >
          <div className="text-xl font-bold text-gray-900">{activasCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">Activas</div>
        </button>
        <button
          onClick={() => router.push('/inf-campaigns')}
          className="bg-white rounded-2xl border border-gray-100 p-4 text-center hover:border-violet-200 transition-colors"
        >
          <div className="text-xl font-bold text-gray-900">{postuladasCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">Postuladas</div>
        </button>
        {totalDeliverables > 0 ? (
          <button
            onClick={() => router.push('/inf-tasks')}
            title="Entregables pendientes"
            className="bg-white rounded-2xl border border-gray-100 p-2 flex flex-col items-center justify-center gap-0.5 hover:border-violet-200 transition-colors overflow-hidden"
          >
            <ResponsiveContainer width={64} height={36} className="flex-shrink-0">
              <PieChart>
                <Pie data={gaugeData} startAngle={180} endAngle={0} cx="50%" cy="100%"
                  innerRadius={18} outerRadius={30} cornerRadius={4} paddingAngle={2} dataKey="value" stroke="none">
                  {gaugeData.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-900 leading-none">{pendingPct}%</div>
              <div className="text-xs text-gray-400 mt-0.5">Pendientes</div>
            </div>
          </button>
        ) : (
          <button
            onClick={() => router.push('/inf-tasks')}
            className="bg-white rounded-2xl border border-gray-100 p-4 text-center hover:border-violet-200 transition-colors"
          >
            <div className="text-xl font-bold text-gray-900">{completadasCount}</div>
            <div className="text-xs text-gray-400 mt-0.5">Completadas</div>
          </button>
        )}
      </div>

      {/* Campañas activas + % completado — al 100% no navega (nada
          pendiente); con menos, lleva directo a sus entregables. */}
      {activeCampaigns.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
            <CheckSquare className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-bold text-gray-900 flex-1">Campañas activas ({activeCampaigns.length})</h2>
          </div>
          <div className="px-5 py-4 space-y-2">
            {activeCampaigns.map(({ ci, pct, total }) => {
              const c = ci.campaign!
              const done = pct === 100
              const Wrapper = done ? 'div' : 'button'
              const extraProps = done ? {} : { onClick: () => router.push(`/inf-tasks?campaign=${c.id}`) }
              return (
                <Wrapper
                  key={c.id}
                  {...extraProps}
                  className={cn(
                    'w-full flex items-center gap-3 bg-gray-50 rounded-xl border border-gray-100 p-3 text-left transition-all',
                    !done && 'hover:border-violet-200 hover:shadow-sm'
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {c.brand?.logo_url
                      ? <img src={c.brand.logo_url} alt={c.brand.name} className="w-8 h-8 object-contain" />
                      : <Building2 className="h-4 w-4 text-violet-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                    {total > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                          <div className={cn('h-full rounded-full', done ? 'bg-green-500' : 'bg-violet-500')} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className={cn('text-xl font-bold flex-shrink-0', done ? 'text-green-500' : 'text-gray-900')}>{pct}%</span>
                </Wrapper>
              )
            })}
          </div>
        </div>
      )}

      {/* Campañas disponibles para postular — ya postuladas NO aparecen acá,
          se ven en /inf-campaigns con el badge "En revisión" (mismo
          endpoint, mismo criterio que esa página, ver 2026-07-01). */}
      {availableCampaigns.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-bold text-gray-900 flex-1">Campañas disponibles ({availableCampaigns.length})</h2>
          </div>
          <div className="px-5 py-4 space-y-2">
            {availableCampaigns.slice(0, 4).map(c => (
              <Link
                key={c.id}
                href={`/inf-campaign/${c.id}`}
                className="flex items-center gap-3 bg-gray-50 rounded-xl border border-gray-100 p-3 hover:border-violet-200 hover:shadow-sm transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {c.brand?.logo_url
                    ? <img src={c.brand.logo_url} alt={c.brand.name} className="w-8 h-8 object-contain" />
                    : <Building2 className="h-4 w-4 text-violet-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                  {c.brand?.name && <p className="text-xs text-violet-600 font-medium">{c.brand.name}</p>}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">Abierta</span>
              </Link>
            ))}
            <Link href="/inf-campaigns" className="block text-center text-xs font-semibold text-violet-600 hover:underline pt-1">
              Ver todas en Campañas →
            </Link>
          </div>
        </div>
      )}

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
