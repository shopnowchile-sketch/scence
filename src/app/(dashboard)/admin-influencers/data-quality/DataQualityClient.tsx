'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, Loader2, RefreshCw, AlertTriangle, Trash2, GitMerge,
  Users, Instagram, Mail, ShieldCheck, Database, Zap, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatFollowers } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface Report {
  total: number
  active: number
  inactive: number
  withoutInstagram: number
  withInstagram: number
  withoutCommune: number
  withoutAddress: number
  missingAnyRequired: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagram: number
  duplicatesByMixed: number
  nicheRanking: RankingItem[]
  geography: GeographyCountry[]
  unassignedGeography: number
}

interface GeographyInfluencer { id: string; display_name: string | null; email: string | null; instagram_username: string | null; followers: number; is_active: boolean; address: string | null }
interface GeographyNode { id: string; label: string; level: 'country' | 'region' | 'city' | 'commune'; count: number; children: GeographyNode[]; influencers: GeographyInfluencer[] }
type GeographyCountry = GeographyNode

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

// href opcional: si viene, la tarjeta completa es un link (pedido Pri:
// tarjetas clickeables hacia /admin-influencers con el filtro correspondiente,
// o hacia una sección de esta misma pantalla como #duplicados-detectados).
function StatCard({ icon: Icon, label, value, tone = 'violet', href }: {
  icon: React.ElementType; label: string; value: number | string; tone?: string; href?: string
}) {
  const content = (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg bg-${tone}-100 flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-4 w-4 text-${tone}-600`} />
      </div>
      <div>
        <div className="text-xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        <div className="text-xs text-gray-400">{label}</div>
      </div>
    </div>
  )
  if (href) {
    return (
      <Link href={href} className="card p-4 block hover:shadow-md hover:border-violet-200 transition-shadow">
        {content}
      </Link>
    )
  }
  return <div className="card p-4">{content}</div>
}

// Ranking de nichos: se mantiene como resumen secundario; la geografía se explora arriba por Región → Comuna → Influencer.
function RankingList({ title, items, paramName }: {
  title: string; items: RankingItem[]; paramName: 'niche'
}) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {items.map(item => (
          <Link
            key={item.value ?? '__none__'}
            href={`/admin-influencers?${paramName}=${encodeURIComponent(item.value ?? '__none__')}`}
            className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm"
          >
            <span className={`truncate ${item.value === null ? 'text-gray-400 italic' : 'text-gray-700'}`}>
              {item.label}
            </span>
            <span className="text-xs font-semibold text-gray-500 flex-shrink-0">{item.count.toLocaleString()}</span>
          </Link>
        ))}
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
  const [selectedGeoPath, setSelectedGeoPath] = useState<string[]>([])
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
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
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
          {/* KPIs — clickeables: Total/Sin Instagram/Duplicados llevan directo,
              Activos/Inactivos son 2 links dentro de la misma tarjeta (no se
              parte en 2 tarjetas para no romper el grid de 4 columnas). */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Database} label="Total influencers" value={report.total} tone="violet" href="/admin-influencers" />

              <div className="card p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-gray-900">
                      <Link href="/admin-influencers?status=active" className="hover:underline hover:text-blue-700">
                        {report.active.toLocaleString()}
                      </Link>
                      <span className="text-gray-300"> / </span>
                      <Link href="/admin-influencers?status=inactive" className="hover:underline hover:text-blue-700">
                        {report.inactive.toLocaleString()}
                      </Link>
                    </div>
                    <div className="text-xs text-gray-400">Activos / Inactivos</div>
                  </div>
                </div>
              </div>

              <StatCard icon={Instagram} label="Sin Instagram" value={report.withoutInstagram} tone="amber" href="/admin-influencers?data_quality=missing_instagram" />
              <StatCard icon={AlertTriangle} label="Registros duplicados" value={report.duplicateRecords} tone="red" href="#duplicados-detectados" />
            </div>
          )}

          {/* Desglose duplicados */}
          {report && (
            <div className="card p-5">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Duplicados por tipo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: Mail, label: 'Por email', value: report.duplicatesByEmail },
                  { icon: Instagram, label: 'Por Instagram', value: report.duplicatesByInstagram },
                  { icon: GitMerge, label: 'Email + Instagram', value: report.duplicatesByMixed },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-3">
                    <s.icon className="h-4 w-4 text-gray-400" />
                    <div>
                      <div className="text-lg font-bold text-gray-900">{s.value}</div>
                      <div className="text-xs text-gray-400">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Geografía: País → Región → Comuna/Ciudad → Influencers */}
          {report && (
            <div className="card p-5">
              {(() => {
                const findPath = (nodes: GeographyNode[], ids: string[]): GeographyNode | null => {
                  if (!ids.length) return null
                  for (const node of nodes) {
                    if (node.id !== ids[0]) continue
                    if (ids.length === 1) return node
                    return findPath(node.children, ids.slice(1))
                  }
                  return null
                }
                const current = findPath(report.geography, selectedGeoPath)
                const currentChildren = current?.children ?? report.geography
                const isLeaf = Boolean(current && current.children.length === 0)
                const currentTitle = current?.label ?? 'País'
                const currentCount = current?.count ?? report.total
                const directInfluencers = current?.influencers ?? []
                const hasUnassigned = selectedGeoPath.length === 0 && report.unassignedGeography > 0
                const goTo = (index: number) => setSelectedGeoPath(selectedGeoPath.slice(0, index))
                return (
                  <>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Distribución geográfica</h3>
                        <p className="text-xs text-gray-400 mt-1">País → Región → Comuna / Ciudad → Influencers · fuente única: locations</p>
                      </div>
                      {selectedGeoPath.length > 0 && (
                        <div className="flex items-center gap-1 text-xs font-semibold text-violet-600 flex-wrap justify-end">
                          <button onClick={() => goTo(0)} className="hover:underline">Países</button>
                          {(() => {
                            const labels: string[] = []
                            let nodes = report.geography
                            selectedGeoPath.forEach((id, index) => {
                              const node = nodes.find(n => n.id === id)
                              if (!node) return
                              labels.push(node.label)
                              nodes = node.children
                            })
                            return labels.map((label, index) => <span key={index} className="flex items-center gap-1"><span className="text-gray-300">/</span><button onClick={() => goTo(index + 1)} className={index === labels.length - 1 ? 'text-gray-500' : 'hover:underline'}>{label}</button></span>)
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg font-bold text-gray-900">{currentTitle}</span>
                      <span className="text-sm text-gray-400">· {currentCount.toLocaleString()} influencers</span>
                    </div>
                    {!isLeaf ? (
                      currentChildren.length === 0 ? (
                        <div className="py-10 text-center text-sm text-gray-400">Sin datos geográficos canónicos en este nivel.</div>
                      ) : (
                        <div className="h-[340px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={currentChildren} margin={{ top: 8, right: 12, left: 0, bottom: 65 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={85} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Influencers']} />
                              <Bar dataKey="count" name="Influencers" fill="#7c3aed" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(entry) => setSelectedGeoPath([...selectedGeoPath, String(entry.id)])} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )
                    ) : null}

                    {directInfluencers.length > 0 && (
                      <div className="mt-5">
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          Influencers asignadas directamente a {currentTitle} · {directInfluencers.length}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-400 border-b"><th className="pb-2">Influencer</th><th className="pb-2">Instagram</th><th className="pb-2">Followers</th><th className="pb-2">Email</th><th className="pb-2">Estado</th></tr></thead>
                            <tbody>{directInfluencers.map(inf => <tr key={inf.id} className="border-b last:border-0"><td className="py-2"><Link href={'/admin-influencers/' + inf.id} target="_blank" className="font-medium text-gray-800 hover:text-violet-700">{inf.display_name || '(sin nombre)'}</Link></td><td className="py-2 text-gray-500">{inf.instagram_username ? '@' + inf.instagram_username : '—'}</td><td className="py-2 text-gray-500">{formatFollowers(inf.followers)}</td><td className="py-2 text-gray-500">{inf.email || '—'}</td><td className="py-2">{inf.is_active ? <span className="badge badge-green text-[10px]">Activa</span> : <span className="badge badge-gray text-[10px]">Inactiva</span>}</td></tr>)}</tbody></table>
                          </div>
                        </div>
                    )}

                    {hasUnassigned && (
                      <div className="mt-5 p-4 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-800">
                        Hay <strong>{report.unassignedGeography.toLocaleString()}</strong> influencers sin ubicación canónica. No se mezclan con País/Región/Comuna para no falsear los gráficos.
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

