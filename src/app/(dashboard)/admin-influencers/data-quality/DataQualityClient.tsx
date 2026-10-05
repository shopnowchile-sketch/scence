'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, Loader2, RefreshCw, AlertTriangle, Trash2, GitMerge,
  Instagram, Mail, ShieldCheck, Zap, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatFollowers } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface Report {
  total: number
  withoutInstagram: number
  withoutLocation: number
  orphanLocation: number
  inactiveLocation: number
  withoutAddress: number
  missingAnyRequired: number
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

interface ScanInfluencer {
  id: string
  display_name: string | null
  email: string | null
  is_active: boolean
  created_at: string | null
  instagram_url: string | null
  instagram_username: string | null
  followers: number
}

interface DuplicateGroup {
  key: string
  type: 'email' | 'instagram' | 'mixed'
  value: string
  influencers: ScanInfluencer[]
}

const TYPE_LABELS: Record<string, string> = {
  email: 'Email', instagram: 'Instagram', mixed: 'Email + Instagram',
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
                <span className="block text-xs text-gray-400 truncate">{inf.instagram_username ? `@${inf.instagram_username}` : 'sin Instagram'}</span>
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
  const qc = useQueryClient()
  const [report, setReport] = useState<Report | null>(null)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [mergingAll, setMergingAll] = useState(false)
  const [mergeAllProgress, setMergeAllProgress] = useState<{ done: number; total: number } | null>(null)
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({})
  const { isAdmin } = useIsAdmin()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rq, dq] = await Promise.all([
        fetch('/api/influencers/data-quality', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/influencers/duplicates', { cache: 'no-store' }).then(r => r.json()),
      ])
      if (rq.report) setReport(rq.report)
      if (dq.groups) {
        setGroups(dq.groups)
        // default keep = el de más followers en cada grupo
        const defaults: Record<string, string> = {}
        for (const g of dq.groups as DuplicateGroup[]) {
          const best = [...g.influencers].sort((a, b) => b.followers - a.followers)[0]
          defaults[g.key] = best.id
        }
        setKeepChoice(defaults)
      }
    } catch {
      toast.error('Error cargando data quality')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Fallback: si por lo que sea keepChoice[g.key] no está seteado (carrera de
  // estado, doble click antes de que cargue, etc.), NUNCA saltar el grupo en
  // silencio — se recalcula el mismo default que usa load() (más followers).
  // Pri: "que nunca se equivoque". Sin este fallback, un keepChoice vacío
  // hacía que "Combinar todos" reportara "0 combinados" sin error visible.
  function resolveKeepId(g: DuplicateGroup): string | undefined {
    return keepChoice[g.key] ?? [...g.influencers].sort((a, b) => b.followers - a.followers)[0]?.id
  }

  async function handleMerge(g: DuplicateGroup) {
    const keepId = resolveKeepId(g)
    if (!keepId) return
    const mergeIds = g.influencers.filter(i => i.id !== keepId).map(i => i.id)
    if (!confirm(`Combinar ${mergeIds.length} duplicado(s) en el registro seleccionado y eliminar permanentemente el resto. ¿Continuar?`)) return
    setBusy(g.key)
    try {
      const r = await fetch('/api/influencers/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, mergeIds }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(`Combinados ${j.merged} · eliminados ${j.deleted}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al combinar')
    } finally { setBusy(null) }
  }

  // Combina TODOS los grupos detectados de una sola pasada, usando el "Conservar"
  // ya preseleccionado en cada grupo (por defecto: el de más followers). Pri:
  // "necesito poder hacer un merge de todas las niñas de una pasada, no uno por
  // uno". Reutiliza el mismo endpoint /api/influencers/merge que ya combinaba
  // un grupo completo en 1 llamada — antes solo faltaba encadenar los grupos.
  // Un solo confirm() al inicio, no uno por grupo. Sigue de largo si un grupo
  // individual falla (se reporta al final) para no trabar el resto.
  async function handleMergeAll() {
    if (groups.length === 0) return
    const totalDuplicates = groups.reduce((s, g) => s + (g.influencers.length - 1), 0)
    if (!confirm(
      `Combinar los ${groups.length} grupos detectados (${totalDuplicates} registro(s) duplicado(s) en total).\n\n` +
      `Se conserva el registro marcado "Conservar" en cada grupo y se elimina permanentemente el resto. ¿Continuar?`
    )) return

    setMergingAll(true)
    setMergeAllProgress({ done: 0, total: groups.length })
    let okCount = 0
    let mergedRecords = 0
    let alreadyResolved = 0
    const failed: string[] = []

    // Un mismo par duplicado puede aparecer en varios grupos a la vez (p.ej.
    // coincide por email Y por Instagram) → 2-3 "grupos" distintos apuntan a
    // los mismos ids. Si el primero ya los combina/borra, un grupo posterior
    // no debe operar sobre ids que ya no existen (404 / keeper equivocado).
    // consumedIds trackea qué ids ya se resolvieron en esta misma pasada.
    const consumedIds = new Set<string>()

    for (const g of groups) {
      const alive = g.influencers.filter(i => !consumedIds.has(i.id))
      if (alive.length < 2) {
        // Ya resuelto por un grupo anterior en esta misma pasada (no es un error).
        alreadyResolved++
        setMergeAllProgress(p => p ? { ...p, done: p.done + 1 } : p)
        continue
      }
      let keepId = keepChoice[g.key]
      if (!keepId || !alive.some(i => i.id === keepId)) {
        // La selección original ya no está viva (o no hay selección) — recalcular
        // sobre los ids que SÍ siguen vivos, nunca dejar el grupo sin resolver.
        keepId = [...alive].sort((a, b) => b.followers - a.followers)[0]?.id
      }
      const mergeIds = alive.filter(i => i.id !== keepId).map(i => i.id)
      if (!keepId || mergeIds.length === 0) {
        failed.push(`${g.value}: no se pudo determinar el registro a conservar`)
        setMergeAllProgress(p => p ? { ...p, done: p.done + 1 } : p)
        continue
      }
      try {
        const r = await fetch('/api/influencers/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepId, mergeIds }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error)
        okCount++
        mergedRecords += j.merged ?? mergeIds.length
        mergeIds.forEach(id => consumedIds.add(id))
      } catch (e) {
        failed.push(`${g.value}: ${e instanceof Error ? e.message : 'error'}`)
      }
      setMergeAllProgress(p => p ? { ...p, done: p.done + 1 } : p)
    }

    const resolvedNote = alreadyResolved > 0 ? ` · ${alreadyResolved} ya resuelto(s) por otro grupo` : ''
    if (failed.length === 0) {
      toast.success(`${okCount} grupo(s) combinados · ${mergedRecords} duplicado(s) eliminados${resolvedNote}`)
    } else {
      toast.error(`${okCount} grupo(s) combinados, ${failed.length} fallaron${resolvedNote}. Ver consola.`)
      console.error('[merge-all] grupos fallidos:', failed)
    }
    setMergingAll(false)
    setMergeAllProgress(null)
    await load()
  }

  async function handleDeleteDuplicates(g: DuplicateGroup) {
    const keepId = resolveKeepId(g)
    const ids = g.influencers.filter(i => i.id !== keepId).map(i => i.id)
    if (!ids.length) return
    if (!confirm(`Eliminar permanentemente ${ids.length} duplicado(s), conservando solo el registro seleccionado. Esta acción no se puede deshacer. ¿Continuar?`)) return
    setBusy(g.key)
    try {
      const r = await fetch('/api/influencers/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, hard: true }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(`${j.deleted} duplicado(s) eliminados`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar')
    } finally { setBusy(null) }
  }

  // Antes eliminaba permanentemente a las influencers sin Instagram. Pri pidió
  // cambiarlo: en vez de borrar, mandarles un email pidiendo que completen
  // Instagram y/o dirección en su perfil (la mayoría sí tiene cuenta y puede
  // hacerlo desde /inf-profile). El endpoint de borrado sigue existiendo por
  // si se necesita en otro flujo, pero este botón ya no lo llama.
  async function handleNotifyNoInstagram() {
    setBusy('no-instagram')
    try {
      const dry = await fetch('/api/influencers/notify-no-instagram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }).then(r => r.json())
      if (!dry.count) { toast.info('No hay influencers con Instagram, comuna o dirección pendientes'); setBusy(null); return }
      if (!confirm(`Enviar email a ${dry.count} influencer(s) pidiendo que completen Instagram/comuna/dirección en su perfil. ¿Continuar?`)) { setBusy(null); return }
      const r = await fetch('/api/influencers/notify-no-instagram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(`Email enviado a ${j.sent} influencer(s)${j.failed ? ` · ${j.failed} fallaron` : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally { setBusy(null) }
  }

  async function handleSendRecoveredAccess() {
    setBusy('recovery-access')
    try {
      const dry = await fetch('/api/influencers/send-recovery-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true }),
      }).then(r => r.json())
      if (!dry.count) { toast.info('No hay accesos de cuentas recuperadas pendientes de envío'); return }
      if (!confirm(`Enviar el email de acceso a ${dry.count} influencer(s) recuperada(s)? Solo se enviará a estas cuentas; no a toda la base.`)) return
      const response = await fetch('/api/influencers/send-recovery-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'No se pudieron enviar los accesos')
      toast.success(`Acceso enviado a ${result.sent} influencer(s)${result.failed ? ` · ${result.failed} fallaron` : ''}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar accesos')
    } finally {
      setBusy(null)
    }
  }

  async function handleSyncAllInstagram() {
    setSyncingAll(true)
    try {
      // Procesa un lote de la cola (nunca sincronizados y más antiguos primero)
      // con Meta Business Discovery. El resto lo toma el lote programado.
      toast.info('Sincronizando un lote con Instagram… puede tardar hasta 4 min', { id: 'sync-progress' })
      const res = await fetch('/api/influencers/sync-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error ?? 'Error al sincronizar')

      const msg = `✅ ${result.synced ?? 0} actualizados · ${result.not_found ?? 0} no sincronizables · ${result.failed ?? 0} con error · ${result.remaining ?? 0} en cola`
      toast.success(msg, { id: 'sync-progress', duration: 8000 })
      if (result.stopped) toast.warning(`Lote detenido: ${result.stopped}`)
      if (result.errors?.length) console.warn('[instagram-followers] detalle:', result.errors)
      // Invalidar TODOS los caches de influencers (lista + detail)
      await qc.invalidateQueries({ queryKey: ['influencers'] })  // useInfluencersList
      await qc.invalidateQueries({ queryKey: ['influencer'] })   // useInfluencer (detail)
      // Signal para useInfluencers (manual fetch hook) — fuerza refetch en la lista
      window.dispatchEvent(new CustomEvent('influencers-synced'))
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al sincronizar Instagram')
    } finally {
      setSyncingAll(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin-influencers" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
            <ChevronLeft className="h-4 w-4" /> Influencers
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-1">Data Quality</h1>
          <p className="text-sm text-gray-500">Limpieza de base antes de importar · Instagram es el identificador principal</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSyncAllInstagram} disabled={syncingAll || loading}
            className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white text-sm font-semibold rounded-lg hover:bg-pink-700 disabled:opacity-50">
            {syncingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Sincronizar Instagram
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Re-escanear
          </button>
        </div>
      </div>

      {loading && !report ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
        </div>
      ) : (
        <>
          {report && <GeographyDrilldown nodes={report.geographyNodes} influencers={report.geographyInfluencers} />}

          {!isAdmin && (
            <div className="card p-4 flex items-center gap-3 border-amber-200 bg-amber-50/40 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              Solo administradores pueden combinar o eliminar registros permanentemente. Tienes vista de solo lectura.
            </div>
          )}

          {/* Acción: pedir a las influencers con Instagram/comuna/dirección incompletos que
              actualicen su perfil. Instagram, comuna y dirección son obligatorios para
              entrar al portal (ProfileCompletionGate). El conteo de la tarjeta de abajo es
              solo "sin Instagram" (viene del report), pero el envío real usa dry-run del
              endpoint, que también detecta a quienes tienen Instagram y les falta comuna o
              dirección — por eso no se oculta el botón cuando withoutInstagram es 0. */}
          {isAdmin && report && (
            <div className="card p-5 flex items-center justify-between border-amber-200 bg-amber-50/40">
              <div className="flex items-center gap-3">
                <Instagram className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Perfiles incompletos (Instagram / ubicación / dirección)</p>
                  <p className="text-xs text-gray-500">
                    {report.withoutInstagram} sin Instagram · {(report.withoutLocation + report.orphanLocation + report.inactiveLocation).toLocaleString('es-CL')} sin ubicación válida · {report.withoutAddress} sin dirección ·{' '}
                    <strong>{report.missingAnyRequired} con algún dato obligatorio faltante</strong>. Los tres son obligatorios para usar el portal.
                  </p>
                </div>
              </div>
              <button
                onClick={handleNotifyNoInstagram}
                disabled={busy === 'no-instagram'}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 flex-shrink-0"
              >
                {busy === 'no-instagram'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                Enviar recordatorio
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="card p-5 flex items-center justify-between border-violet-200 bg-violet-50/40">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-violet-600" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Cuentas recuperadas sin email de acceso</p>
                  <p className="text-xs text-gray-500">Envía un nuevo link solo a las influencers que fueron reparadas tras quedar huérfanas.</p>
                </div>
              </div>
              <button onClick={handleSendRecoveredAccess} disabled={busy === 'recovery-access'}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50">
                {busy === 'recovery-access' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar emails de acceso
              </button>
            </div>
          )}

          {/* Duplicados */}
          <div id="duplicados-detectados" className="space-y-3 scroll-mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                Duplicados detectados ({groups.length} grupo{groups.length !== 1 ? 's' : ''})
              </h3>
              {isAdmin && groups.length > 1 && (
                <button onClick={handleMergeAll} disabled={mergingAll || busy !== null}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">
                  {mergingAll
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <GitMerge className="h-3.5 w-3.5" />}
                  {mergingAll && mergeAllProgress
                    ? `Combinando… (${mergeAllProgress.done}/${mergeAllProgress.total})`
                    : `Combinar todos (${groups.length})`}
                </button>
              )}
            </div>
            {groups.length === 0 ? (
              <div className="card p-8 text-center">
                <ShieldCheck className="h-10 w-10 text-emerald-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">Sin duplicados. Base limpia ✅</p>
              </div>
            ) : groups.map(g => (
              <div key={g.key} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-gray text-[11px]">{TYPE_LABELS[g.type]}</span>
                    <span className="text-sm font-semibold text-gray-700 truncate max-w-xs">{g.value}</span>
                    <span className="text-xs text-gray-400">· {g.influencers.length} registros</span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleMerge(g)} disabled={busy === g.key}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 rounded-lg border border-violet-200 hover:bg-violet-50 disabled:opacity-50">
                        {busy === g.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                        Combinar
                      </button>
                      <button onClick={() => handleDeleteDuplicates(g)} disabled={busy === g.key}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" /> Eliminar duplicados
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {g.influencers.map(inf => (
                    <label key={inf.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input type="radio" name={`keep-${g.key}`} checked={keepChoice[g.key] === inf.id}
                        onChange={() => setKeepChoice(p => ({ ...p, [g.key]: inf.id }))}
                        className="text-violet-600" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/admin-influencers/${inf.id}`} target="_blank"
                            className="text-sm font-medium text-gray-900 hover:text-violet-700 truncate">
                            {inf.display_name ?? '(sin nombre)'}
                          </Link>
                          {!inf.is_active && <span className="badge badge-gray text-[10px]">Inactivo</span>}
                          {keepChoice[g.key] === inf.id && <span className="badge badge-green text-[10px]">Conservar</span>}
                        </div>
                        <div className="text-xs text-gray-400 truncate">
                          {inf.email ?? 'sin email'} · {inf.instagram_username ? `@${inf.instagram_username}` : 'sin IG'} · {formatFollowers(inf.followers)} followers
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
