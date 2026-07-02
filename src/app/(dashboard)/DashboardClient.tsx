'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  ExternalLink,
  Loader2,
  RefreshCw,
  UserCheck,
  Users,
} from 'lucide-react'

type UnknownRecord = Record<string, unknown>

interface DashboardState {
  loading: boolean
  error: string | null
  dashboard: unknown
  analytics: unknown
  campaigns: UnknownRecord[]
  influencers: UnknownRecord[]
  brands: UnknownRecord[]
  invoices: UnknownRecord[]
  deliverables: UnknownRecord[]
}

interface LivePerson {
  id: string
  name: string
  username: string
  time: string
}

interface ActivityItem {
  id: string
  title: string
  subtitle: string
  time: string
}

const INITIAL_STATE: DashboardState = {
  loading: true,
  error: null,
  dashboard: null,
  analytics: null,
  campaigns: [],
  influencers: [],
  brands: [],
  invoices: [],
  deliverables: [],
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const clean = value.trim().replace(/[^\d,.-]/g, '')
  if (!clean) return null

  const normalized = /^\d{1,3}(\.\d{3})+$/.test(clean)
    ? clean.replace(/\./g, '')
    : clean.replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function readText(record: UnknownRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return fallback
}

function deepFind(source: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5) return null
  const wanted = new Set(keys.map(normalizeKey))

  if (Array.isArray(source)) {
    for (const item of source) {
      const found = deepFind(item, keys, depth + 1)
      if (found !== null && found !== undefined) return found
    }
    return null
  }

  if (!isRecord(source)) return null

  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizeKey(key))) return value
  }

  for (const value of Object.values(source)) {
    const found = deepFind(value, keys, depth + 1)
    if (found !== null && found !== undefined) return found
  }

  return null
}

function deepNumber(source: unknown, keys: string[], fallback = 0) {
  const found = deepFind(source, keys)
  return readNumber(found) ?? fallback
}

function pickArray(source: unknown, keys: string[]): UnknownRecord[] {
  if (Array.isArray(source)) return toRecordArray(source)
  if (!isRecord(source)) return []

  for (const key of keys) {
    const direct = source[key]
    const directArray = toRecordArray(direct)
    if (directArray.length) return directArray

    if (isRecord(direct)) {
      const nested = toRecordArray(direct.data ?? direct.items ?? direct.results)
      if (nested.length) return nested
    }
  }

  const common = ['data', 'items', 'results', 'campaigns', 'influencers', 'brands', 'invoices', 'deliverables']
  for (const key of common) {
    const direct = toRecordArray(source[key])
    if (direct.length) return direct
  }

  return []
}

function formatCLP(value: number) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0))
}

function formatShortDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(date)
}

function isRecentlyOnline(record: UnknownRecord) {
  const explicit =
    record.is_online === true ||
    record.online === true ||
    record.presence_status === 'online' ||
    record.status === 'online'

  if (explicit) return true

  // FIX (2026-07-02): /api/influencers enriquece cada fila con last_sign_in_at
  // (viene de profiles.last_seen_at, ver esa ruta) pero nunca se chequeaba esa
  // key acá — "Live influencers" siempre daba 0 sin importar la actividad real.
  const raw =
    readText(record, ['last_seen_at']) ||
    readText(record, ['last_activity_at']) ||
    readText(record, ['portal_last_seen_at']) ||
    readText(record, ['portal_logged_in_at']) ||
    readText(record, ['last_sign_in_at'])

  if (!raw) return false

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return false

  return Date.now() - date.getTime() < 10 * 60 * 1000
}

function hasPortalAccess(record: UnknownRecord) {
  return Boolean(
    record.portal_logged_in_at ||
    record.last_sign_in_at ||
    record.last_seen_at ||
    record.user_id ||
    record.auth_user_id
  )
}

function hasEnteredPortal(record: UnknownRecord) {
  return Boolean(
    record.portal_logged_in_at ||
    record.last_sign_in_at ||
    record.last_seen_at ||
    record.last_activity_at
  )
}

function isActiveCampaign(record: UnknownRecord) {
  const status = readText(record, ['status'], '').toLowerCase()
  return !['completed', 'cancelled', 'canceled', 'archived', 'deleted'].includes(status)
}

function isPendingDeliverable(record: UnknownRecord) {
  const status = readText(record, ['status'], '').toLowerCase()
  return !['completed', 'done', 'approved', 'cancelled', 'canceled', 'deleted'].includes(status)
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
    })

    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function KpiCard({
  icon,
  value,
  title,
  subtitle,
  tone,
}: {
  icon: React.ReactNode
  value: string
  title: string
  subtitle: string
  tone: 'purple' | 'blue' | 'green' | 'red' | 'yellow' | 'gray'
}) {
  const tones = {
    purple: 'bg-purple-100 text-purple-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-emerald-100 text-emerald-600',
    red: 'bg-rose-100 text-rose-600',
    yellow: 'bg-amber-100 text-amber-600',
    gray: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        {icon}
      </div>
      <div className="text-3xl font-black tracking-tight text-gray-950">{value}</div>
      <div className="mt-1 text-sm font-medium text-gray-500">{title}</div>
      <div className="mt-1 text-xs text-gray-300">{subtitle}</div>
    </div>
  )
}

function PortalAccessCard({
  title,
  subtitle,
  entered,
  pending,
  href,
  linkLabel,
}: {
  title: string
  subtitle: string
  entered: number
  pending: number
  href: string
  linkLabel: string
}) {
  const total = Math.max(entered + pending, 1)
  const percent = Math.round((entered / total) * 100)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-gray-950">{title}</h3>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        <Link href={href} className="text-xs font-semibold text-purple-600 hover:text-purple-700">
          {linkLabel} ›
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-emerald-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-500">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-gray-950">{entered}</div>
              <div className="text-xs text-gray-500">Han ingresado</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-orange-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-500">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-gray-950">{pending}</div>
              <div className="text-xs text-gray-500">Aún no ingresan</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs text-gray-400">
          <span>Adopción del portal</span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  )
}

function RevenueChart({ revenue, payroll }: { revenue: number; payroll: number }) {
  const max = Math.max(revenue, payroll, 1)
  const revenueHeight = Math.max(4, Math.round((revenue / max) * 140))
  const payrollHeight = Math.max(2, Math.round((payroll / max) * 140))
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-950">Revenue vs Payroll</h3>
          <p className="text-xs text-gray-400">Últimos 6 meses (CLP)</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />Facturado</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />Payroll</span>
        </div>
      </div>

      <div className="relative h-52">
        <div className="absolute inset-0 flex flex-col justify-between text-xs text-gray-300">
          {[4, 3, 2, 1, 0].map((line) => (
            <div key={line} className="flex items-center gap-3">
              <span className="w-10">{formatCLP((max / 4) * line).replace(/\s/g, '')}</span>
              <div className="h-px flex-1 border-t border-dashed border-gray-100" />
            </div>
          ))}
        </div>

        <div className="absolute bottom-7 left-12 right-4 flex h-36 items-end justify-end gap-2">
          <div className="w-3 rounded-t bg-blue-300" style={{ height: `${payrollHeight}px` }} />
          <div className="w-3 rounded-t bg-purple-500" style={{ height: `${revenueHeight}px` }} />
        </div>

        <div className="absolute bottom-0 left-12 right-4 flex justify-between text-xs text-gray-400">
          {months.map((month) => <span key={month}>{month}</span>)}
        </div>
      </div>
    </div>
  )
}

function PlatformsCard({ deliverables }: { deliverables: UnknownRecord[] }) {
  const counts = deliverables.reduce<Record<string, number>>((acc, item) => {
    const platform = readText(item, ['platform', 'channel', 'type'], 'Otros')
    acc[platform] = (acc[platform] ?? 0) + 1
    return acc
  }, {})

  const entries: Array<[string, number]> = Object.entries(counts)
  const safeEntries: Array<[string, number]> = entries.length ? entries : [['Otros', 1]]
  const total = safeEntries.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-gray-950">Plataformas</h3>
      <p className="mb-10 text-xs text-gray-400">Distribución de deliverables</p>

      <div className="space-y-5">
        {safeEntries.slice(0, 4).map(([platform, count]) => {
          const percent = Math.round((count / total) * 100)
          return (
            <div key={platform}>
              <div className="mb-2 flex items-center gap-3">
                <span className="w-16 text-xs text-gray-500">{platform}</span>
                <div className="h-3 flex-1 rounded-full bg-gray-200">
                  <div className="h-3 rounded-full bg-gray-300" style={{ width: `${percent}%` }} />
                </div>
              </div>
              <div className="flex justify-between pl-20 text-xs text-gray-400">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-8 space-y-3">
        {safeEntries.slice(0, 3).map(([platform, count]) => (
          <div key={platform} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-gray-500">
              <span className="h-2 w-2 rounded-full bg-gray-200" />
              {platform}
            </span>
            <span className="font-bold text-gray-900">{Math.round((count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardClient() {
  const [state, setState] = useState<DashboardState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setState((current) => ({ ...current, loading: true, error: null }))

      const [
        dashboard,
        analytics,
        campaignsRaw,
        influencersRaw,
        brandsRaw,
        invoicesRaw,
        deliverablesRaw,
      ] = await Promise.all([
        fetchJson('/api/dashboard'),
        fetchJson('/api/analytics'),
        fetchJson('/api/campaigns'),
        fetchJson('/api/influencers?limit=100'),
        fetchJson('/api/brands'),
        fetchJson('/api/invoices'),
        fetchJson('/api/deliverables'),
      ])

      if (cancelled) return

      setState({
        loading: false,
        error: null,
        dashboard,
        analytics,
        campaigns: pickArray(campaignsRaw, ['campaigns', 'data', 'items']),
        influencers: pickArray(influencersRaw, ['influencers', 'data', 'items']),
        brands: pickArray(brandsRaw, ['brands', 'data', 'items']),
        invoices: pickArray(invoicesRaw, ['invoices', 'data', 'items']),
        deliverables: pickArray(deliverablesRaw, ['deliverables', 'data', 'items']),
      })
    }

    loadDashboard().catch(() => {
      if (!cancelled) {
        setState((current) => ({
          ...current,
          loading: false,
          error: 'No se pudo cargar el dashboard',
        }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const computed = useMemo(() => {
    const activeCampaigns = state.campaigns.filter(isActiveCampaign)
    const campaignCount =
      deepNumber(state.dashboard, ['activeCampaigns', 'active_campaigns', 'campaignsActive'], activeCampaigns.length || state.campaigns.length)

    const influencersTotal =
      deepNumber(state.dashboard, ['totalInfluencers', 'influencersTotal', 'influencersRoster'], state.influencers.length)

    const brandsTotal =
      deepNumber(state.dashboard, ['totalBrands', 'brandsTotal', 'registeredBrands'], state.brands.length)

    // FIX (2026-07-02): estas 3 métricas siempre daban $0/0% — buscaban keys
    // ('revenue', 'facturado', 'payroll', 'inboundCosts', etc.) que no existen
    // en la respuesta real de /api/dashboard (kpis.revenue_month, kpis.payroll_month,
    // kpis.margin, kpis.margin_pct — ver esa ruta). Se agregan esos nombres reales.
    // Además: "Costos recibidos" describía un concepto que no existe en el schema
    // (invoices no tiene columna `direction`; Scence no recibe "facturas" de la
    // marca, la marca le paga a Scence — eso YA es "Facturado"). Esa tarjeta se
    // repropone más abajo como "Payroll pagado" (costo real: pago a influencers).
    const revenue =
      deepNumber(state.dashboard, ['revenue_month', 'outboundRevenue', 'revenue', 'facturado', 'totalRevenue'], 0) ||
      deepNumber(state.analytics, ['revenue_month', 'outboundRevenue', 'revenue', 'facturado', 'totalRevenue'], 0)

    const payroll =
      deepNumber(state.dashboard, ['payroll_month', 'payroll', 'totalPayroll', 'payrollTotal'], 0) ||
      deepNumber(state.analytics, ['payroll_month', 'payroll', 'totalPayroll', 'payrollTotal'], 0)

    const margin =
      deepNumber(state.dashboard, ['margin'], revenue - payroll) ||
      (revenue - payroll)

    const marginPercent =
      deepNumber(state.dashboard, ['margin_pct', 'marginPercent'], 0) ||
      (revenue > 0 ? Math.max(0, Math.round((margin / revenue) * 100)) : 0)

    const liveFromDashboard = pickArray(state.dashboard, ['liveInfluencers', 'live_influencers', 'onlineInfluencers'])
    const liveSource = liveFromDashboard.length ? liveFromDashboard : state.influencers.filter(isRecentlyOnline)

    const liveInfluencers: LivePerson[] = liveSource.slice(0, 6).map((person, index) => ({
      id: readText(person, ['id'], String(index)),
      name: readText(person, ['name', 'full_name', 'display_name'], 'Influencer'),
      username: readText(person, ['instagram_username', 'username', 'handle'], ''),
      time: 'hace instantes',
    }))

    // FIX (2026-07-02): antes se derivaba del array capado /api/influencers?limit=100
    // (con 1452 influencers reales, undercounteaba brutalmente — "35/99" en vez del
    // roster real). Ahora /api/dashboard trae influencer_portal.{entered,pending}
    // calculado server-side contra TODA la org, sin límite de fila. Se usa -1 como
    // sentinel (no `|| fallback`) porque 0 es un valor real válido (org sin nadie
    // conectado aún) y `0 || x` caería al fallback incorrectamente.
    const influencersEnteredReal = deepNumber(state.dashboard, ['entered'], -1)
    const influencersPendingReal = deepNumber(state.dashboard, ['pending'], -1)

    const influencersEntered = influencersEnteredReal >= 0
      ? influencersEnteredReal
      : state.influencers.filter(hasEnteredPortal).length

    const influencersWithAccess =
      state.influencers.filter(hasPortalAccess).length || influencersTotal

    const brandsEntered =
      deepNumber(state.dashboard, ['brandsEntered', 'brandsIngresaron', 'brandPortalEntered'], 0) ||
      state.brands.filter(hasEnteredPortal).length

    const brandsWithAccess =
      state.brands.filter(hasPortalAccess).length || brandsTotal

    const pendingDeliverables = state.deliverables.filter(isPendingDeliverable).slice(0, 4)
    const campaignsForList = (activeCampaigns.length ? activeCampaigns : state.campaigns).slice(0, 3)

    const activityFromDashboard = pickArray(state.dashboard, ['recentActivity', 'activity', 'recent_activity'])
    const activity: ActivityItem[] = (activityFromDashboard.length ? activityFromDashboard : campaignsForList).slice(0, 5).map((item, index) => ({
      id: readText(item, ['id'], String(index)),
      title: readText(item, ['title', 'name', 'campaign_name'], 'Actividad reciente'),
      subtitle: readText(item, ['status'], 'actualizado'),
      time: readText(item, ['relative_time', 'time'], '') || formatShortDate(item.created_at),
    }))

    return {
      campaignCount,
      influencersTotal,
      brandsTotal,
      revenue,
      payroll,
      margin,
      marginPercent,
      liveInfluencers,
      influencersEntered,
      influencersPending: influencersPendingReal >= 0
        ? influencersPendingReal
        : Math.max(0, influencersWithAccess - influencersEntered),
      brandsEntered,
      brandsPending: Math.max(0, brandsWithAccess - brandsEntered),
      campaignsForList,
      pendingDeliverables,
      activity,
    }
  }, [state])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        <header>
          <div className="mb-1 flex items-center gap-2 text-sm text-purple-400">
            <Activity className="h-4 w-4" />
            <span>lunes 29 de junio, 2026</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-black tracking-tight text-gray-950">Dashboard</h1>
            {state.loading && (
              <span className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando
              </span>
            )}
          </div>
          {state.error && <p className="mt-2 text-sm text-rose-500">{state.error}</p>}
        </header>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">Operación</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              icon={<CalendarDays className="h-5 w-5" />}
              value={String(computed.campaignCount)}
              title="Campañas en curso"
              subtitle="este mes"
              tone="purple"
            />
            <KpiCard
              icon={<Users className="h-5 w-5" />}
              value={String(computed.influencersTotal)}
              title="Influencers en roster"
              subtitle="total (activos + inactivos)"
              tone="blue"
            />
            <KpiCard
              icon={<Building2 className="h-5 w-5" />}
              value={String(computed.brandsTotal)}
              title="Marcas registradas"
              subtitle="en el sistema"
              tone="gray"
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <h2 className="text-base font-bold text-gray-950">Live influencers</h2>
                <RefreshCw className="h-3.5 w-3.5 text-gray-300" />
              </div>
              <div className="text-3xl font-black text-gray-950">{computed.liveInfluencers.length}</div>
            </div>

            {computed.liveInfluencers.length ? (
              <div className="space-y-3">
                {computed.liveInfluencers.map((person) => (
                  <div key={person.id} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <div>
                        <div className="text-sm font-bold text-gray-950">{person.name}</div>
                        {person.username && <div className="text-xs text-gray-400">@{person.username.replace(/^@/, '')}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{person.time}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-50 text-gray-300">
                  <Activity className="h-4 w-4" />
                </div>
                <p className="text-sm text-gray-400">Nadie conectado ahora</p>
                <p className="text-xs text-gray-300">Aparecen acá con el portal influencer abierto</p>
              </div>
            )}
          </div>

          <PortalAccessCard
            title="Acceso al portal de influencers"
            subtitle={`${Math.round(((computed.influencersEntered) / Math.max(computed.influencersEntered + computed.influencersPending, 1)) * 100)}% del roster ha ingresado`}
            entered={computed.influencersEntered}
            pending={computed.influencersPending}
            href="/admin-influencers"
            linkLabel="Ver roster"
          />
          <PortalAccessCard
            title="Acceso al portal de marcas"
            subtitle={`${Math.round(((computed.brandsEntered) / Math.max(computed.brandsEntered + computed.brandsPending, 1)) * 100)}% de las marcas ha ingresado`}
            entered={computed.brandsEntered}
            pending={computed.brandsPending}
            href="/admin-brands"
            linkLabel="Ver marcas"
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <RevenueChart revenue={computed.revenue} payroll={computed.payroll} />
          </div>
          <PlatformsCard deliverables={state.deliverables} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-950">Campañas activas</h3>
              <Link href="/admin-campaigns" className="text-xs font-semibold text-purple-600">Ver todo ›</Link>
            </div>

            <div className="space-y-5">
              {computed.campaignsForList.length ? computed.campaignsForList.map((campaign, index) => {
                const name = readText(campaign, ['name', 'title', 'campaign_name'], 'Campaña')
                const count = readNumber(campaign.influencer_count) ?? readNumber(campaign.influencers_count) ?? 0
                const due = formatShortDate(campaign.end_date || campaign.due_date)
                const progress = Math.max(0, Math.min(100, readNumber(campaign.progress) ?? readNumber(campaign.completion_rate) ?? 0))

                return (
                  <div key={readText(campaign, ['id'], String(index))}>
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-gray-950">{name}</div>
                        <div className="text-xs text-gray-400">{count} influencers {due ? `· vence ${due}` : ''}</div>
                      </div>
                      <div className="text-xs font-bold text-gray-500">{progress}%</div>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-amber-400" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )
              }) : (
                <div className="py-10 text-center text-sm text-gray-400">No hay campañas activas</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-950">Deliverables pendientes</h3>
              <Link href="/admin-campaigns" className="text-xs font-semibold text-purple-600">Ver todo ›</Link>
            </div>

            <div className="space-y-4">
              {computed.pendingDeliverables.length ? computed.pendingDeliverables.map((deliverable, index) => {
                const title = readText(deliverable, ['title', 'name', 'description'], 'Deliverable pendiente')
                const owner = readText(deliverable, ['influencer_name', 'creator_name', 'assigned_to'], '')
                const campaign = readText(deliverable, ['campaign_name'], '')
                const due = formatShortDate(deliverable.due_date)

                return (
                  <div key={readText(deliverable, ['id'], String(index))} className="flex gap-3">
                    <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-gray-950">{title}</div>
                      <div className="truncate text-xs text-gray-400">{[owner, campaign].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="text-right text-xs text-gray-400">
                      <div>{due}</div>
                      <div>Pendiente</div>
                    </div>
                  </div>
                )
              }) : (
                <div className="py-10 text-center text-sm text-gray-400">No hay deliverables pendientes</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-6 text-base font-bold text-gray-950">Actividad reciente</h3>
          <div className="space-y-4">
            {computed.activity.length ? computed.activity.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100 text-purple-500">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">{item.title}</div>
                    <div className="text-xs text-gray-400">{item.subtitle}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400">{item.time}</div>
              </div>
            )) : (
              <div className="py-10 text-center text-sm text-gray-400">Sin actividad reciente</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default DashboardClient
