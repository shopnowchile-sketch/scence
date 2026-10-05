'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useRouter, useSearchParams } from 'next/navigation'

interface Report {
  geographyNodes: GeographyCountNode[]
  geographyInfluencers: GeographyInfluencer[]
}

type LocationStatus = 'ok' | 'missing' | 'orphan' | 'inactive'

interface GeographyInfluencer {
  id: string
  display_name: string | null
  instagram_username: string | null
  is_active: boolean
  location_status: LocationStatus
  location_id: string | null
  instagram_hint: 'conflict' | 'pending' | null
}

interface GeographyNode {
  id: string
  parent_id: string | null
  name: string
  level: 'country' | 'region' | 'city' | 'commune'
}

interface GeographyCountNode extends GeographyNode {
  direct: number
}

const BAR_COLOR = '#7c3aed'
const UNSPECIFIED_COLOR = '#d1d5db'
const fmt = (n: number) => n.toLocaleString('es-CL')
const pct = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0)

// Tokens del parámetro ?geo=… (ruta del drilldown en la URL, para que
// "atrás" del navegador vuelva al nivel anterior, también desde la ficha).
const DIRECT = '__direct'    // influencers asignadas a este nivel, sin nivel inferior
const INVALID = '__invalid'  // sin ubicación válida
const STATUS_LABELS: Record<Exclude<LocationStatus, 'ok'>, string> = {
  missing: 'Sin ubicación', orphan: 'Ubicación huérfana', inactive: 'Ubicación inactiva',
}

type BarRow = { id: string; name: string; count: number; muted?: boolean }

// Barras horizontales ordenadas (una sola serie). Clic en una barra = bajar
// un nivel. La barra "sin … especificada" va en gris.
function HBarChart({ data, onSelect }: { data: BarRow[]; onSelect: (id: string) => void }) {
  return (
    <div style={{ height: data.length * 32 + 16 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={170} interval={0} tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: '#374151' }} />
          <Tooltip cursor={{ fill: '#f5f3ff' }} formatter={(v: number) => [fmt(v), 'Influencers']} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20} cursor="pointer"
            onClick={(entry: { id?: string }) => { if (entry?.id) onSelect(entry.id) }}>
            {data.map(row => <Cell key={row.id} fill={row.muted ? UNSPECIFIED_COLOR : BAR_COLOR} />)}
            <LabelList dataKey="count" position="right" formatter={(v: number) => fmt(v)} style={{ fontSize: 12, fill: '#6b7280' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function InfluencerList({ rows, showStatus }: { rows: GeographyInfluencer[]; showStatus?: boolean }) {
  const [visible, setVisible] = useState(50)
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-gray-400">Sin influencers en este nivel.</p>
  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {rows.slice(0, visible).map(inf => (
          <li key={inf.id}>
            <Link href={`/admin-influencers/${inf.id}`} className="flex items-center justify-between gap-3 px-2 py-2.5 rounded-lg hover:bg-violet-50/60">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{inf.display_name || '(sin nombre)'}</span>
                <span className={`block text-xs truncate ${inf.instagram_hint ? 'text-amber-600' : 'text-gray-400'}`}>
                  {inf.instagram_username ? `@${inf.instagram_username}`
                    : inf.instagram_hint === 'conflict' ? 'Instagram coincide con otra ficha'
                    : inf.instagram_hint === 'pending' ? 'Instagram pendiente de resolver'
                    : 'sin Instagram'}
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                {showStatus && inf.location_status !== 'ok' && <span className="badge badge-gray text-[10px]">{STATUS_LABELS[inf.location_status]}</span>}
                {!inf.is_active && <span className="badge badge-gray text-[10px]">Inactiva</span>}
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > visible && (
        <button onClick={() => setVisible(v => v + 50)} className="mt-2 text-xs font-semibold text-violet-600 hover:underline">
          Ver más ({fmt(rows.length - visible)} restantes)
        </button>
      )}
    </div>
  )
}

// Drilldown geográfico: País → Región → Comuna/Ciudad → Influencers → ficha.
// Vista sobre datos existentes: report.geographyNodes/geographyInfluencers
// vienen de influencers.location_id → locations, calculados en cada request.
// Nada se guarda; los conteos suman el subárbol de cada nodo.
function GeographyDrilldown({ nodes, influencers }: { nodes: GeographyCountNode[]; influencers: GeographyInfluencer[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const path = (searchParams.get('geo') ?? '').split(',').filter(Boolean)

  const { byId, childrenOf, total } = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const childrenOf = new Map<string | null, GeographyCountNode[]>()
    for (const n of nodes) {
      const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), n])
    }
    const total = new Map<string, number>()
    const sum = (id: string): number => {
      if (!total.has(id)) total.set(id, (byId.get(id)?.direct ?? 0) + (childrenOf.get(id) ?? []).reduce((t, c) => t + sum(c.id), 0))
      return total.get(id)!
    }
    nodes.forEach(n => sum(n.id))
    return { byId, childrenOf, total }
  }, [nodes])

  const invalid = useMemo(() => influencers.filter(i => i.location_status !== 'ok'), [influencers])
  const go = (next: string[]) => router.push(next.length ? `?geo=${next.join(',')}` : '?', { scroll: false })

  const last = path[path.length - 1]
  const showInvalid = last === INVALID
  const showDirect = last === DIRECT
  const nodePath = path.filter(p => p !== DIRECT && p !== INVALID && byId.has(p))
  const current = nodePath.length ? byId.get(nodePath[nodePath.length - 1])! : null
  const children = (childrenOf.get(current?.id ?? null) ?? [])
    .map(n => ({ id: n.id, name: n.name, count: total.get(n.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es-CL'))

  // Subárbol del nodo actual (para listar todas sus influencers en una hoja).
  const inSubtree = (locationId: string | null) => {
    let id = locationId
    while (id) { if (id === current?.id) return true; id = byId.get(id)?.parent_id ?? null }
    return false
  }
  const childLevel = (childrenOf.get(current?.id ?? null) ?? [])[0]?.level
  const unspecifiedLabel = childLevel === 'region' ? 'Sin región especificada' : childLevel === 'commune' || childLevel === 'city' ? 'Sin comuna especificada' : 'Sin nivel inferior'

  let list: GeographyInfluencer[] | null = null
  if (showInvalid) list = invalid
  else if (current && showDirect) list = influencers.filter(i => i.location_id === current.id)
  else if (current && children.length === 0) list = influencers.filter(i => inSubtree(i.location_id))
  list?.sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'es-CL'))

  const bars: BarRow[] = [...children]
  if (current && children.length > 0 && current.direct > 0) bars.push({ id: DIRECT, name: unspecifiedLabel, count: current.direct, muted: true })

  const crumbs: Array<{ label: string; to: string[] }> = [{ label: 'Data Quality', to: [] }]
  nodePath.forEach((id, idx) => crumbs.push({ label: byId.get(id)?.name ?? '', to: nodePath.slice(0, idx + 1) }))
  if (showDirect) crumbs.push({ label: unspecifiedLabel, to: path })
  if (showInvalid) crumbs.push({ label: 'Sin ubicación válida', to: path })

  // Con ubicación válida = suma de países (misma base que el gráfico).
  const located = (childrenOf.get(null) ?? []).reduce((t, n) => t + (total.get(n.id) ?? 0), 0)
  const heading = showInvalid ? 'Sin ubicación válida'
    : list ? `Influencers · ${showDirect ? `${current?.name} (${unspecifiedLabel.toLowerCase()})` : current?.name}`
    : current ? `${childLevel === 'region' ? 'Regiones' : 'Comunas / ciudades'} de ${current.name}` : 'Influencers por país'

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="Ruta geográfica">
          {crumbs.map((c, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
              {idx === crumbs.length - 1
                ? <span className="font-semibold text-gray-900">{c.label}</span>
                : <button onClick={() => go(c.to)} className="font-medium text-violet-600 hover:underline">{c.label}</button>}
            </span>
          ))}
        </nav>
        {crumbs.length > 1 && (
          <button onClick={() => go(crumbs[crumbs.length - 2].to)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900">
            <ChevronLeft className="h-3.5 w-3.5" /> Volver
          </button>
        )}
      </div>
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-3">{heading}</h3>
      <p className="text-xs text-gray-400 mb-4">
        {list
          ? `${fmt(list.length)} influencers · clic para abrir su ficha`
          : current
            ? `${fmt(total.get(current.id) ?? 0)} influencers · clic para bajar de nivel`
            : `${fmt(located)} con ubicación válida · clic en un país para ver sus regiones`}
      </p>

      {list ? (
        <InfluencerList rows={list} showStatus={showInvalid} />
      ) : (
        <div className={current ? '' : 'grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start'}>
          <HBarChart key={current?.id ?? 'root'} data={bars} onSelect={id => go([...nodePath, id])} />
          {!current && (
            <button onClick={() => go([INVALID])} disabled={invalid.length === 0}
              className="text-left rounded-xl border border-amber-200 bg-amber-50/60 p-4 hover:bg-amber-50 disabled:opacity-50">
              <span className="flex items-center gap-2 text-xs font-bold text-amber-700 uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4" /> Sin ubicación válida
              </span>
              <span className="block text-3xl font-bold text-gray-900 tabular-nums mt-2">{fmt(invalid.length)}</span>
              <span className="block text-xs text-gray-500 mt-1">{pct(invalid.length, located + invalid.length)}% del total · ver listado →</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function DataQualityClient() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/influencers/data-quality', { cache: 'no-store' })
      .then(async r => {
        const body = await r.json()
        if (!r.ok || !body.report) throw new Error(body.error ?? 'Error cargando Data Quality')
        setReport(body.report)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando Data Quality'))
  }, [])

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <Link href="/admin-influencers" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
          <ChevronLeft className="h-4 w-4" /> Influencers
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-1">Data Quality</h1>
        <p className="text-sm text-gray-500">Ubicación de las influencers según locations · País → Región → Comuna</p>
      </div>

      {error ? (
        <div className="card p-6 text-sm text-red-600">{error}</div>
      ) : !report ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
        </div>
      ) : (
        <GeographyDrilldown nodes={report.geographyNodes} influencers={report.geographyInfluencers} />
      )}
    </div>
  )
}
