'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, Loader2, RefreshCw, AlertTriangle, Trash2, GitMerge,
  Users, Instagram, Mail, ShieldCheck, Database, Zap, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useRouter } from 'next/navigation'
import { formatFollowers } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface Report {
  total: number
  active: number
  inactive: number
  withoutInstagram: number
  withInstagram: number
  withoutLocation: number
  orphanLocation: number
  inactiveLocation: number
  withoutAddress: number
  missingAnyRequired: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagram: number
  duplicatesByMixed: number
  nicheRanking: RankingItem[]
  geographyNodes: GeographyCountNode[]
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

interface RankingItem {
  value: string | null
  label: string
  count: number
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

// ── Paleta ────────────────────────────────────────────────────────────────────
// Una serie = un tono (violeta SCENCE). Estados de calidad usan colores de
// estado reservados y siempre van con etiqueta + número (nunca color solo).
const BAR_COLOR = '#7c3aed'
const STATUS_COLORS = { ok: '#16a34a', missing: '#d97706', inactive: '#ea580c', orphan: '#dc2626' } as const
const LEVEL_COLORS = { commune: '#6d28d9', region: '#8b5cf6', country: '#c4b5fd', none: '#d1d5db' } as const

const pct = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0)
const fmt = (n: number) => n.toLocaleString('es-CL')

function KpiCard({ icon: Icon, label, value, sub, href, tone }: {
  icon: React.ElementType; label: string; value: number; sub?: React.ReactNode; href?: string
  tone: 'violet' | 'blue' | 'amber' | 'red'
}) {
  const tones = {
    violet: 'bg-violet-50 text-violet-600', blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
  }
  const body = (
    <div className="flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">{fmt(value)}</div>
        <div className="text-xs font-medium text-gray-500">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
    </div>
  )
  return href
    ? <Link href={href} className="card p-4 block hover:shadow-md hover:border-violet-200 transition-shadow">{body}</Link>
    : <div className="card p-4">{body}</div>
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</h3>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

// Barra 100% apilada + leyenda con número y porcentaje. Cada segmento tiene
// su etiqueta en la leyenda (la identidad nunca depende solo del color).
function MeterCard({ title, hint, total, segments, footer }: {
  title: string; hint?: string; total: number
  segments: Array<{ key: string; label: string; value: number; color: string; href?: string }>
  footer?: React.ReactNode
}) {
  return (
    <div className="card p-5 flex flex-col">
      <SectionTitle title={title} hint={hint} />
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-gray-100" role="img"
        aria-label={segments.map(s => `${s.label}: ${s.value}`).join(', ')}>
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.key} title={`${s.label}: ${fmt(s.value)} (${pct(s.value, total)}%)`}
            style={{ width: `${pct(s.value, total)}%`, background: s.color, minWidth: 3 }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {segments.map(s => {
          const row = (
            <>
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                <span className="text-gray-700 truncate">{s.label}</span>
              </span>
              <span className="tabular-nums text-gray-900 font-semibold flex-shrink-0">
                {fmt(s.value)} <span className="text-gray-400 font-normal">· {pct(s.value, total)}%</span>
              </span>
            </>
          )
          return (
            <li key={s.key}>
              {s.href && s.value > 0
                ? <Link href={s.href} className="flex items-center justify-between gap-3 rounded-md -mx-1 px-1 hover:bg-gray-50">{row}</Link>
                : <div className="flex items-center justify-between gap-3">{row}</div>}
            </li>
          )
        })}
      </ul>
      {footer && <div className="mt-auto pt-4 text-xs text-gray-500">{footer}</div>}
    </div>
  )
}

// Barras horizontales ordenadas (una sola serie). Valor directo al final de
// cada barra + tooltip. onSelect convierte cada barra en un paso de drilldown.
function HBarChart({ data, onSelect, emptyText }: {
  data: Array<{ id: string; name: string; count: number }>
  onSelect?: (id: string) => void
  emptyText: string
}) {
  if (data.length === 0) return <div className="py-10 text-center text-sm text-gray-400">{emptyText}</div>
  return (
    <div style={{ height: data.length * 30 + 16 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={150} interval={0} tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: '#374151' }} />
          <Tooltip cursor={{ fill: '#f5f3ff' }} formatter={(v: number) => [fmt(v), 'Influencers']} />
          <Bar dataKey="count" fill={BAR_COLOR} radius={[0, 4, 4, 0]} maxBarSize={18}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={onSelect ? (entry: { id?: string }) => { if (entry?.id) onSelect(entry.id) } : undefined}>
            <LabelList dataKey="count" position="right" formatter={(v: number) => fmt(v)}
              style={{ fontSize: 11, fill: '#6b7280' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Distribución geográfica. Fuente única: report.geographyNodes, construido en
// el servidor desde influencers.location_id → locations. Los totales de cada
// nodo suman su subárbol; los nombres salen tal cual de locations.
function GeographySection({ nodes, located, unlocated }: { nodes: GeographyCountNode[]; located: number; unlocated: number }) {
  const { byId, childrenOf, total } = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const childrenOf = new Map<string | null, GeographyCountNode[]>()
    for (const n of nodes) {
      const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), n])
    }
    const total = new Map<string, number>()
    const sum = (id: string): number => {
      if (total.has(id)) return total.get(id)!
      const value = (byId.get(id)?.direct ?? 0) + (childrenOf.get(id) ?? []).reduce((t, c) => t + sum(c.id), 0)
      total.set(id, value)
      return value
    }
    nodes.forEach(n => sum(n.id))
    return { byId, childrenOf, total }
  }, [nodes])

  const rows = (parent: string | null) => (childrenOf.get(parent) ?? [])
    .map(n => ({ id: n.id, name: n.name, count: total.get(n.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es-CL'))

  const countries = rows(null)
  // Ruta del drilldown bajo un país: [país, región, ...]. Por defecto el país
  // con más influencers, para que la vista inicial ya muestre regiones.
  const [path, setPath] = useState<string[]>([])
  const effectivePath = path.length ? path : countries[0] ? [countries[0].id] : []
  const currentId = effectivePath[effectivePath.length - 1] ?? null
  const current = currentId ? byId.get(currentId) ?? null : null
  const children = current ? rows(current.id) : []
  const childLevel = current ? (childrenOf.get(current.id) ?? [])[0]?.level : undefined
  const directHere = current?.direct ?? 0

  const levelLabel = (level?: GeographyNode['level']) =>
    level === 'region' ? 'Regiones' : level === 'commune' ? 'Comunas' : level === 'city' ? 'Ciudades' : 'Ubicaciones'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <div className="card p-5 lg:col-span-2">
        <SectionTitle title="Influencers por país" hint={`${fmt(located)} con ubicación válida · clic para ver sus regiones`} />
        <HBarChart data={countries} onSelect={id => setPath([id])} emptyText="Sin influencers con ubicación." />
        {unlocated > 0 && (
          <p className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
            <span className="font-semibold text-gray-700 tabular-nums">{fmt(unlocated)}</span> sin ubicación válida no se asignan a ningún país.
          </p>
        )}
      </div>

      <div className="card p-5 lg:col-span-3">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {levelLabel(childLevel)}{current ? ` de ${current.name}` : ''}
            </h3>
            <nav className="flex items-center gap-1 text-xs mt-1 flex-wrap" aria-label="Ruta geográfica">
              {effectivePath.map((id, idx) => {
                const last = idx === effectivePath.length - 1
                return (
                  <span key={id} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-gray-300">›</span>}
                    {last
                      ? <span className="font-semibold text-gray-700">{byId.get(id)?.name}</span>
                      : <button onClick={() => setPath(effectivePath.slice(0, idx + 1))} className="font-semibold text-violet-600 hover:underline">{byId.get(id)?.name}</button>}
                  </span>
                )
              })}
              {current && <span className="text-gray-400">· {fmt(total.get(current.id) ?? 0)} influencers</span>}
            </nav>
          </div>
          {current && (current.level === 'commune' || current.level === 'city') && (
            <Link href={`/admin-influencers?commune=${encodeURIComponent(current.name)}`}
              className="text-xs font-semibold text-violet-600 hover:underline flex-shrink-0">
              Ver influencers →
            </Link>
          )}
        </div>

        {current && children.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{fmt(total.get(current.id) ?? 0)}</p>
            <p className="text-sm text-gray-500 mb-4">influencers en {current.name}</p>
            <Link href={`/admin-influencers?commune=${encodeURIComponent(current.name)}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">
              Ver listado filtrado
            </Link>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto pr-1">
            <HBarChart key={currentId ?? 'root'} data={children} emptyText="Sin subdivisiones con influencers."
              onSelect={id => setPath([...effectivePath, id])} />
          </div>
        )}
        {current && children.length > 0 && directHere > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            + {fmt(directHere)} asignadas solo a nivel {current.level === 'country' ? 'país' : 'región'} ({current.name}), sin {current.level === 'country' ? 'región' : 'comuna'}.
          </p>
        )}
      </div>
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
  const router = useRouter()

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
          {report && (() => {
            const invalidLocation = report.orphanLocation + report.inactiveLocation
            const validLocation = report.total - report.withoutLocation - invalidLocation
            const levelCount = (levels: GeographyNode['level'][]) =>
              report.geographyNodes.filter(n => levels.includes(n.level)).reduce((t, n) => t + n.direct, 0)
            const niches = report.nicheRanking.filter(n => n.value !== null)
            const withoutNiche = report.nicheRanking.find(n => n.value === null)?.count ?? 0
            return (
              <>
                {/* 1 · KPIs: cuántas hay, activas, Instagram, duplicados */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard icon={Database} tone="violet" label="Total influencers" value={report.total} href="/admin-influencers"
                    sub={<>{fmt(validLocation)} con ubicación válida ({pct(validLocation, report.total)}%)</>} />
                  <KpiCard icon={Users} tone="blue" label="Activas" value={report.active}
                    sub={<><Link href="/admin-influencers?status=active" className="hover:underline">{pct(report.active, report.total)}% activas</Link>{' · '}
                      <Link href="/admin-influencers?status=inactive" className="hover:underline">{fmt(report.inactive)} inactivas</Link></>} />
                  <KpiCard icon={Instagram} tone="amber" label="Sin Instagram" value={report.withoutInstagram} href="/admin-influencers?data_quality=missing_instagram"
                    sub={<>{pct(report.withInstagram, report.total)}% con Instagram</>} />
                  <KpiCard icon={AlertTriangle} tone="red" label="Registros duplicados" value={report.duplicateRecords} href="#duplicados-detectados"
                    sub={<>{fmt(report.duplicateGroups)} grupo{report.duplicateGroups !== 1 ? 's' : ''}</>} />
                </div>

                {/* 2 · Calidad de datos: ubicación, completitud geográfica, Instagram, duplicados */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <MeterCard title="Calidad de ubicación" hint="influencers.location_id → locations" total={report.total}
                    segments={[
                      { key: 'ok', label: 'Ubicación válida', value: validLocation, color: STATUS_COLORS.ok },
                      { key: 'missing', label: 'Sin ubicación', value: report.withoutLocation, color: STATUS_COLORS.missing },
                      { key: 'orphan', label: 'Ubicación huérfana', value: report.orphanLocation, color: STATUS_COLORS.orphan },
                      { key: 'inactive', label: 'Ubicación inactiva', value: report.inactiveLocation, color: STATUS_COLORS.inactive },
                    ]}
                    footer={<><strong className="text-gray-700">{fmt(validLocation)} / {fmt(report.total)}</strong> con ubicación válida</>} />
                  <MeterCard title="Nivel de ubicación" hint="Precisión del dato geográfico" total={report.total}
                    segments={[
                      { key: 'commune', label: 'Comuna / Ciudad', value: levelCount(['commune', 'city']), color: LEVEL_COLORS.commune },
                      { key: 'region', label: 'Solo región', value: levelCount(['region']), color: LEVEL_COLORS.region },
                      { key: 'country', label: 'Solo país', value: levelCount(['country']), color: LEVEL_COLORS.country },
                      { key: 'none', label: 'Sin ubicación válida', value: report.withoutLocation + invalidLocation, color: LEVEL_COLORS.none },
                    ]} />
                  <MeterCard title="Instagram" hint="Identificador principal de la influencer" total={report.total}
                    segments={[
                      { key: 'with', label: 'Con Instagram', value: report.withInstagram, color: STATUS_COLORS.ok },
                      { key: 'without', label: 'Sin Instagram', value: report.withoutInstagram, color: STATUS_COLORS.missing, href: '/admin-influencers?data_quality=missing_instagram' },
                    ]} />
                  <div className="card p-5">
                    <SectionTitle title="Duplicados por tipo" hint="Registros sobrantes por criterio" />
                    <ul className="space-y-3">
                      {[
                        { icon: Mail, label: 'Por email', value: report.duplicatesByEmail },
                        { icon: Instagram, label: 'Por Instagram', value: report.duplicatesByInstagram },
                        { icon: GitMerge, label: 'Email + Instagram', value: report.duplicatesByMixed },
                      ].map(d => (
                        <li key={d.label} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-gray-700"><d.icon className="h-4 w-4 text-gray-400" />{d.label}</span>
                          <span className="font-semibold tabular-nums text-gray-900">{fmt(d.value)}</span>
                        </li>
                      ))}
                    </ul>
                    {report.duplicateRecords === 0
                      ? <p className="mt-4 text-xs text-emerald-600 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Base sin duplicados</p>
                      : <a href="#duplicados-detectados" className="mt-4 inline-block text-xs font-semibold text-violet-600 hover:underline">Revisar duplicados →</a>}
                  </div>
                </div>

                {/* 3 · Distribución geográfica: País → Región → Comuna/Ciudad → Influencers */}
                <div>
                  <h2 className="text-sm font-bold text-gray-900 mb-3">Distribución geográfica</h2>
                  <GeographySection nodes={report.geographyNodes} located={validLocation} unlocated={report.total - validLocation} />
                </div>

                {/* 4 · Nichos */}
                <div className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <SectionTitle title="Influencers por nicho" hint="Una influencer puede tener varios nichos · clic para ver el listado" />
                    {withoutNiche > 0 && (
                      <Link href="/admin-influencers?niche=__none__" className="text-xs text-gray-500 hover:text-violet-700 flex-shrink-0">
                        <span className="font-semibold text-gray-900 tabular-nums">{fmt(withoutNiche)}</span> sin nicho ({pct(withoutNiche, report.total)}%) →
                      </Link>
                    )}
                  </div>
                  <HBarChart data={niches.slice(0, 12).map(n => ({ id: n.value as string, name: n.label, count: n.count }))}
                    emptyText="Sin nichos registrados."
                    onSelect={id => router.push(`/admin-influencers?niche=${encodeURIComponent(id)}`)} />
                </div>
              </>
            )
          })()}

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
                    {report.withoutInstagram} sin Instagram · {fmt(report.withoutLocation + report.orphanLocation + report.inactiveLocation)} sin ubicación válida · {report.withoutAddress} sin dirección ·{' '}
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
