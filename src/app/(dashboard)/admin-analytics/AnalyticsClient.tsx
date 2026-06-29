'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, DollarSign, Target, Users, CheckCircle2,
  BarChart2, Percent,
} from 'lucide-react'
import { formatCurrency, formatFollowers, cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AnalyticsData {
  revenue_trend: Array<{ month: string; revenue: number; payroll: number; campaigns: number }>
  campaign_stats: {
    total: number; active: number; completed: number
    total_budget: number; total_spent: number
    by_type: Record<string, number>
  }
  deliverable_stats: {
    total: number; completion_rate: number
    by_status: Record<string, number>
    by_platform: Record<string, number>
  }
  top_influencers: Array<{
    name: string; avatar: string | null
    total: number; engagement: number; followers: number
  }>
}

// ── Empty fallback (shown while loading / no Supabase data) ──────────────────
const FALLBACK: AnalyticsData = {
  revenue_trend: [],
  campaign_stats: { total: 0, active: 0, completed: 0, total_budget: 0, total_spent: 0, by_type: {} },
  deliverable_stats: { total: 0, completion_rate: 0, by_status: {}, by_platform: {} },
  top_influencers: [],
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAnalytics(range: string): Promise<AnalyticsData> {
  const res = await fetch(`/api/analytics?range=${range}`)
  if (!res.ok) throw new Error('Error al cargar analytics')
  return res.json()
}

// ── Colors ────────────────────────────────────────────────────────────────────
const COLORS = {
  violet: '#7c3aed', blue: '#3b82f6', emerald: '#10b981',
  amber: '#f59e0b', pink: '#ec4899', cyan: '#06b6d4', red: '#ef4444',
}
const STATUS_COLORS: Record<string, string> = {
  pending: '#e2e8f0', in_review: '#fbbf24', approved: '#60a5fa', rejected: '#f87171', published: '#34d399',
}
const TYPE_COLORS = [COLORS.violet, COLORS.blue, COLORS.emerald, COLORS.amber, COLORS.pink, COLORS.cyan]
const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#a855f7', tiktok: '#6366f1', youtube: '#ec4899',
  twitter: '#38bdf8', facebook: '#3b82f6', linkedin: '#0ea5e9',
}

const GRADIENTS = ['from-pink-400 to-violet-500', 'from-blue-400 to-cyan-500', 'from-emerald-400 to-teal-500', 'from-orange-400 to-red-500']

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function RevTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const nameMap: Record<string, string> = { revenue: 'Facturado', payroll: 'Payroll' }
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-500">{nameMap[p.name] ?? p.name}</span>
          </span>
          <span className="font-bold text-gray-900">{formatCurrency(p.value, 'CLP')}</span>
        </div>
      ))}
    </div>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPI({ icon: Icon, color, label, value, sub }: { icon: React.ElementType; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className={`w-9 h-9 rounded-xl bg-${color}-100 flex items-center justify-center mb-3`}>
        <Icon className={`h-4 w-4 text-${color}-600`} />
      </div>
      <div className="text-2xl font-black text-gray-900 tracking-tight">{value}</div>
      <div className="text-sm text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-300 mt-1">{sub}</div>}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function AnalyticsClient() {
  const [range, setRange] = useState<'1m' | '3m' | '6m' | '12m'>('6m')

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', range],
    queryFn:  () => fetchAnalytics(range),
    staleTime: 1000 * 60 * 10,
  })

  const d = data ?? FALLBACK
  const cs = d.campaign_stats
  const ds = d.deliverable_stats

  // Pie data for deliverable status
  const statusPie = Object.entries(ds.by_status).map(([name, value]) => ({
    name: name === 'in_review' ? 'En revisión' : name.charAt(0).toUpperCase() + name.slice(1),
    value,
    color: STATUS_COLORS[name] ?? '#e2e8f0',
  })).filter(p => p.value > 0)

  // Bar data for campaign types
  const typeBar = Object.entries(cs.by_type).map(([type, count], i) => ({
    name: type.replace(/_/g, ' '),
    value: count,
    color: TYPE_COLORS[i % TYPE_COLORS.length],
  }))

  // Platform bar
  const platformBar = Object.entries(ds.by_platform)
    .sort((a, b) => b[1] - a[1])
    .map(([p, v]) => ({ name: p.charAt(0).toUpperCase() + p.slice(1), value: v, color: PLATFORM_COLORS[p] ?? COLORS.violet }))

  const totalRevenue  = d.revenue_trend.reduce((s, m) => s + m.revenue, 0)
  const totalPayroll  = d.revenue_trend.reduce((s, m) => s + m.payroll, 0)
  const avgMarginPct  = totalRevenue > 0 ? Math.round(((totalRevenue - totalPayroll) / totalRevenue) * 100) : 0
  const budgetUsedPct = cs.total_budget > 0 ? Math.round((cs.total_spent / cs.total_budget) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Performance de campañas, influencers y finanzas</p>
        </div>
        {/* Range selector */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(['1m', '3m', '6m', '12m'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                range === r ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPI icon={DollarSign}   color="violet"  label="Revenue total"      value={formatCurrency(totalRevenue, 'CLP')} sub={`${range} seleccionado`} />
        <KPI icon={TrendingUp}   color="emerald" label="Margen promedio"     value={`${avgMarginPct}%`} sub={formatCurrency(totalRevenue - totalPayroll, 'CLP')} />
        <KPI icon={Target}       color="blue"    label="Budget utilizado"    value={`${budgetUsedPct}%`} sub={`${formatCurrency(cs.total_spent, 'CLP')} de ${formatCurrency(cs.total_budget, 'CLP')}`} />
        <KPI icon={CheckCircle2} color="amber"   label="Tasa de completion" value={`${ds.completion_rate}%`} sub={`${ds.by_status.published ?? 0} de ${ds.total} publicados`} />
      </div>

      {/* Revenue trend */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-gray-900">Revenue vs Payroll</h2>
            <p className="text-xs text-gray-400 mt-0.5">Evolución financiera en el período</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {[['Facturado', COLORS.violet], ['Payroll', COLORS.blue]].map(([label, color]) => (
              <span key={label as string} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color as string }} />
                <span className="text-gray-500">{label}</span>
              </span>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={d.revenue_trend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="aRevGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.violet} stopOpacity={0.15} />
                <stop offset="95%" stopColor={COLORS.violet} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="aPayGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.12} />
                <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<RevTooltip />} />
            <Area type="monotone" dataKey="revenue" stroke={COLORS.violet} strokeWidth={2} fill="url(#aRevGrad)" dot={false} activeDot={{ r: 4 }} />
            <Area type="monotone" dataKey="payroll" stroke={COLORS.blue}   strokeWidth={2} fill="url(#aPayGrad)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 3-column row: status pie + platform bar + campaign type bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Deliverable status donut */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Deliverables</h3>
          <p className="text-xs text-gray-400 mb-4">Estado actual</p>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={100} height={100}>
              <PieChart>
                <Pie data={statusPie} cx="50%" cy="50%" innerRadius={28} outerRadius={44} paddingAngle={2} dataKey="value">
                  {statusPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {statusPie.map(s => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </span>
                  <span className="font-bold text-gray-700">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-xs">
            <span className="text-gray-400">Tasa de aprobación</span>
            <span className="font-bold text-emerald-600">
              {ds.total > 0 ? Math.round(((ds.by_status.approved + ds.by_status.published) / ds.total) * 100) : 0}%
            </span>
          </div>
        </div>

        {/* Platform distribution */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Plataformas</h3>
          <p className="text-xs text-gray-400 mb-4">Deliverables por red</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={platformBar} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                {platformBar.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Campaign types */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Tipo de campaña</h3>
          <p className="text-xs text-gray-400 mb-4">Distribución del mix</p>
          <div className="space-y-2.5">
            {typeBar.map(t => {
              const pct = cs.total > 0 ? Math.round((t.value / cs.total) * 100) : 0
              return (
                <div key={t.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 capitalize">{t.name}</span>
                    <span className="font-semibold text-gray-700">{t.value} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Top influencers */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-gray-900">Top Influencers</h2>
            <p className="text-xs text-gray-400 mt-0.5">Por total facturado en el período</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100">
                {['#', 'Influencer', 'Seguidores', 'Engagement', 'Total facturado', 'Fee share'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {d.top_influencers.map((inf, i) => {
                const totalAllFees = d.top_influencers.reduce((s, x) => s + x.total, 0)
                const share = totalAllFees > 0 ? Math.round((inf.total / totalAllFees) * 100) : 0
                const grad = GRADIENTS[i % GRADIENTS.length]
                return (
                  <tr key={inf.name} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-3 py-3 text-sm font-bold text-gray-400">#{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        {inf.avatar ? (
                          <img src={inf.avatar} alt={inf.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-bold`}>
                            {inf.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                        )}
                        <span className="text-sm font-semibold text-gray-900">{inf.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">{formatFollowers(inf.followers)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(inf.engagement * 10, 100)}%` }} />
                        </div>
                        <span className="text-sm font-medium text-gray-700">{inf.engagement.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm font-bold text-gray-900">{formatCurrency(inf.total, 'CLP')}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{share}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {d.top_influencers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">
                    Sin datos de influencers para este período
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Budget execution */}
      <div className="card p-5">
        <h2 className="text-base font-bold text-gray-900 mb-5">Ejecución de Budget</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { label: 'Budget total asignado',  value: formatCurrency(cs.total_budget, 'CLP'),  color: 'bg-violet-500', pct: 100 },
            { label: 'Ejecutado',               value: formatCurrency(cs.total_spent, 'CLP'),   color: 'bg-emerald-500', pct: budgetUsedPct },
            { label: 'Disponible',              value: formatCurrency(cs.total_budget - cs.total_spent, 'CLP'), color: 'bg-gray-200', pct: 100 - budgetUsedPct },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">{item.label}</span>
                <span className="text-sm font-bold text-gray-900">{item.value}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${item.color}`} style={{ width: `${item.pct}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-1">{item.pct}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
