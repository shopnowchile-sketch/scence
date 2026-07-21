'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Calendar,
  LogOut, RefreshCw,
  CheckSquare, Sparkles, Instagram, AlertCircle, Lightbulb, Film, ArrowRight, CalendarClock, CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { isDeliverableComplete } from '@/lib/deliverable-status'
import { BrandBadge, CampaignCover } from '@/components/influencer/CampaignVisual'

// ── Types ─────────────────────────────────────────────────────────────────────

type Campaign = {
  id: string
  status: string
  application_status: string | null
  origin: string | null
  fee: number | null
  currency: string
  campaign: {
    id: string
    name: string
    status: string
    type?: string | null
    start_date: string | null
    end_date: string | null
    deliverable_templates?: Array<{ type: string; quantity?: number }> | null
    brand: { name: string; logo_url: string | null; instagram?: string | null } | null
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
  brand: { id: string; name: string; logo_url: string | null; instagram?: string | null } | null
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

  // % de entregables pendientes sobre el total, sumando TODAS las campañas
  // asignadas (no por campaña) — mismo dato ya cargado (campaign_deliverables
  // via /api/influencer/campaigns), sin fetch nuevo.
  const allDeliverables = campaigns.flatMap(ci => ci.campaign_deliverables ?? [])
  const totalDeliverables = allDeliverables.length
  // Mismo criterio de "completado" que el resto de la app (ver activeCampaigns
  // más abajo y CampaignDetail.tsx en admin): URL subida o status aprobado/
  // completado/publicado. Antes solo miraba status, así que un entregable ya
  // entregado pero todavía 'pending'/'in_review' contaba como pendiente.
  const pendingDeliverablesCount = allDeliverables.filter(d => !isDeliverableComplete(d)).length

  // Disponibles para postular, sin las que ya postuló (esas se ven en
  // /inf-campaigns como "En revisión" — mismo criterio que ya usa esa
  // página, acá solo se filtra en el cliente sobre el mismo endpoint).
  const availableCampaigns = openCampaigns.filter(c => !c._applied)

  // Invitaciones pendientes de marca (origin='invitation', pending, campaña
  // activa): la influencer acepta/rechaza acá mismo o revisa el detalle.
  const pendingInvitations = campaigns.filter(
    ci => ci.origin === 'invitation'
      && ci.application_status === 'pending'
      && ci.campaign?.status === 'active'
      && ci.campaign?.id
  )

  // Campañas activas con su % de entregables completados — pedido: verlas
  // en el dashboard (no solo el conteo agregado del gauge). Al 100% no pasa
  // nada al hacer clic (ya no hay nada pendiente que subir); con menos de
  // 100% lleva directo a los entregables de esa campaña.
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
      const done   = delivs.filter(isDeliverableComplete).length
      const pct    = total > 0 ? Math.round((done / total) * 100) : 0
      return { ci: x.ci, pct, total }
    })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Cabecera: el estado de hoy queda claro antes de mostrar campañas. */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 overflow-hidden">
            {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" /> : profile?.display_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-500">Mi portal</p>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">Hola, {profile?.display_name} 👋</h1>
            <p className="text-sm capitalize text-gray-400">{new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
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

      <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <button
          onClick={() => router.push('/inf-deliverables')}
          className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-fuchsia-500 p-6 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15" />
          <div className="absolute bottom-0 right-20 h-24 w-24 rounded-full border-[18px] border-white/10" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white/75">Tu prioridad de hoy</p>
                <h2 className="mt-1 max-w-md text-2xl font-bold tracking-tight">
                  {pendingDeliverablesCount ? `Tienes ${pendingDeliverablesCount} entrega${pendingDeliverablesCount > 1 ? 's' : ''} por resolver` : 'Vas al día con tus entregas'}
                </h2>
              </div>
              <span className="rounded-2xl bg-white/15 p-3"><Film className="h-6 w-6" /></span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{pendingDeliverablesCount ? 'Ir a mis entregables' : 'Ver mis campañas'}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-violet-700 transition-transform group-hover:translate-x-1"><ArrowRight className="h-4 w-4" /></span>
            </div>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => router.push('/inf-campaigns')} className="rounded-3xl border border-gray-100 bg-white p-5 text-left transition-all hover:border-violet-200 hover:shadow-sm">
            <CalendarClock className="h-5 w-5 text-violet-500" />
            <p className="mt-5 text-3xl font-bold tracking-tight text-gray-950">{activasCount}</p>
            <p className="mt-1 text-xs font-medium text-gray-500">Campañas activas</p>
          </button>
          <button onClick={() => router.push('/inf-campaigns')} className="rounded-3xl border border-gray-100 bg-white p-5 text-left transition-all hover:border-amber-200 hover:shadow-sm">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <p className="mt-5 text-3xl font-bold tracking-tight text-gray-950">{postuladasCount}</p>
            <p className="mt-1 text-xs font-medium text-gray-500">En revisión</p>
          </button>
          <button onClick={() => router.push('/inf-deliverables')} className="col-span-2 flex items-center gap-3 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-4 text-left transition-all hover:border-emerald-200">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-500"><CheckCircle2 className="h-5 w-5" /></span>
            <span><span className="block text-sm font-bold text-gray-900">{totalDeliverables - pendingDeliverablesCount} de {totalDeliverables} entregables al día</span><span className="text-xs text-gray-500">Revisa avances y próximos plazos</span></span>
          </button>
        </div>
      </section>

      {/* Orientación de uso: explica el criterio de asignación sin prometer
          una aceptación automática ni convertirlo en una advertencia. */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-xl bg-white text-violet-600 flex items-center justify-center flex-shrink-0">
            <Lightbulb className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-violet-950">Tu participación abre nuevas oportunidades</h2>
            <p className="text-xs text-violet-800 leading-relaxed mt-1.5">
              En SCENCE existe un ranking interno que considera tu participación, el cumplimiento de plazos y la calidad de tus entregas. Antes de postular, revisa el brief y confirma que puedes cumplir con la campaña.
            </p>
            <p className="text-xs text-violet-800 leading-relaxed mt-2">
              Cumplir tus compromisos y entregar a tiempo fortalece tu perfil y aumenta tus posibilidades de ser considerada para nuevas campañas y colaboraciones exclusivas.
            </p>
          </div>
        </div>
      </div>

      {/* Invitaciones pendientes — la marca te invitó. "Revisar invitación"
          abre el detalle (vista previa limitada) donde aceptas o rechazas.
          Solo aparecen invitaciones a campañas ACTIVAS (draft/pending_approval
          quedan ocultas por el backend). */}
      {pendingInvitations.length > 0 && (
        <div className="bg-white rounded-2xl border border-violet-100 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-violet-50">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-bold text-gray-900 flex-1">Invitaciones pendientes ({pendingInvitations.length})</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {pendingInvitations.map(ci => {
              const c = ci.campaign!
              const templates = c.deliverable_templates ?? []
              const delivSummary = templates.length > 0
                ? templates.slice(0, 3).map(t => `${t.quantity && t.quantity > 1 ? `${t.quantity} ` : ''}${String(t.type).replace(/_/g, ' ')}`).join(' · ')
                  + (templates.length > 3 ? ` +${templates.length - 3}` : '')
                : null
              return (
                <div key={c.id} className="flex items-start gap-3 bg-violet-50/50 rounded-xl border border-violet-100 p-3">
                  {c.brand?.logo_url ? (
                    <img src={c.brand.logo_url} alt={c.brand.name} className="w-9 h-9 rounded-lg object-contain bg-white border border-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-600">
                      {c.brand?.name?.charAt(0) ?? '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">Invitación</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.brand?.name ?? 'Marca'}
                      {c.type && <> · <span className="capitalize">{String(c.type).replace(/_/g, ' ')}</span></>}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-400">
                      {(c.start_date || c.end_date) && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {c.start_date ? new Date(c.start_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—'}
                          {' → '}
                          {c.end_date ? new Date(c.end_date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—'}
                        </span>
                      )}
                      {ci.fee != null && ci.fee > 0 && (
                        <span className="font-medium text-gray-500">{ci.fee.toLocaleString('es-CL')} {ci.currency}</span>
                      )}
                    </div>
                    {delivSummary && (
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">Entregables: {delivSummary}</p>
                    )}
                  </div>
                  <button
                    onClick={() => router.push(`/inf-campaign/${c.id}`)}
                    className="flex-shrink-0 self-center text-xs font-bold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    Revisar invitación
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Campañas activas + % completado — al 100% no navega (nada
          pendiente); con menos, lleva directo a sus entregables. */}
      {activeCampaigns.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3"><h2 className="text-base font-bold text-gray-900">Campañas activas</h2><Link href="/inf-campaigns" className="text-xs font-semibold text-violet-600">Ver todas</Link></div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeCampaigns.map(({ ci, pct, total }) => {
              const c = ci.campaign!
              const done = pct === 100
              return (
                <button key={c.id} onClick={() => router.push(`/inf-campaign/${c.id}`)} className="group overflow-hidden rounded-3xl border border-gray-100 bg-white text-left hover:border-violet-200 hover:shadow-lg transition-all">
                  <CampaignCover name={c.name} className="h-40 transition-transform duration-300 group-hover:scale-[1.02]" />
                  <div className="p-5">
                    <BrandBadge name={c.brand?.name ?? null} logoUrl={c.brand?.logo_url} instagram={c.brand?.instagram} />
                    <div className="flex items-end justify-between gap-3 mt-5">
                      <div className="min-w-0"><p className="text-sm font-bold text-gray-900">{done ? 'Todo enviado' : 'Acción pendiente'}</p><p className="text-xs text-gray-400 mt-1">{total ? `${total} entregable${total !== 1 ? 's' : ''} en esta campaña` : 'Revisa el brief de la campaña'}</p></div>
                      <span className={cn('text-2xl font-bold tracking-tight', done ? 'text-emerald-500' : 'text-violet-600')}>{pct}%</span>
                    </div>
                    {total > 0 && <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-4"><div className={cn('h-full rounded-full', done ? 'bg-emerald-500' : 'bg-violet-500')} style={{ width: `${pct}%` }} /></div>}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
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
        <Link href="/inf-deliverables" className="flex items-center gap-1.5 text-gray-500 hover:text-violet-600 transition-colors">
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
