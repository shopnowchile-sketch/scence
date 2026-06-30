'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, Loader2, RefreshCw, AlertTriangle, Trash2, GitMerge,
  Users, Instagram, Mail, ShieldCheck, Database, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { formatFollowers } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface Report {
  total: number
  active: number
  inactive: number
  withoutInstagram: number
  withInstagram: number
  duplicateGroups: number
  duplicateRecords: number
  duplicatesByEmail: number
  duplicatesByInstagramUrl: number
  duplicatesByInstagram: number
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
  type: 'email' | 'instagram_url' | 'instagram'
  value: string
  influencers: ScanInfluencer[]
}

const TYPE_LABELS: Record<string, string> = {
  email: 'Email', instagram_url: 'Instagram URL', instagram: 'Instagram @',
}

function StatCard({ icon: Icon, label, value, tone = 'violet' }: {
  icon: React.ElementType; label: string; value: number | string; tone?: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg bg-${tone}-100 flex items-center justify-center flex-shrink-0`}>
          <Icon className={`h-4 w-4 text-${tone}-600`} />
        </div>
        <div>
          <div className="text-xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</div>
          <div className="text-xs text-gray-400">{label}</div>
        </div>
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
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({})
  const { isAdmin } = useIsAdmin()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rq, dq] = await Promise.all([
        fetch('/api/influencers/data-quality').then(r => r.json()),
        fetch('/api/influencers/duplicates').then(r => r.json()),
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

  async function handleMerge(g: DuplicateGroup) {
    const keepId = keepChoice[g.key]
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

  async function handleDeleteDuplicates(g: DuplicateGroup) {
    const keepId = keepChoice[g.key]
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

  async function handleDeleteNoInstagram() {
    setBusy('no-instagram')
    try {
      const dry = await fetch('/api/influencers/delete-no-instagram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }).then(r => r.json())
      if (!dry.count) { toast.info('No hay influencers sin Instagram'); setBusy(null); return }
      if (!confirm(`Eliminar permanentemente ${dry.count} influencer(s) sin Instagram. Esta acción no se puede deshacer. ¿Continuar?`)) { setBusy(null); return }
      const r = await fetch('/api/influencers/delete-no-instagram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(`${j.deleted} influencer(s) sin Instagram eliminados`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally { setBusy(null) }
  }

  async function handleSyncAllInstagram() {
    setSyncingAll(true)
    try {
      // 1. Start Apify run
      const startRes = await fetch('/api/influencers/sync-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const startJson = await startRes.json()
      if (!startRes.ok) throw new Error(startJson.error ?? 'Error al iniciar sync')
      if (!startJson.runId) {
        toast.info(startJson.message ?? 'No hay perfiles de Instagram para sincronizar')
        return
      }
      toast.info(`Sincronizando ${startJson.total} perfiles con Instagram… puede tardar 1-2 min`)

      // 2. Poll until done
      const { runId } = startJson
      const deadline = Date.now() + 300_000 // 5 min for bulk
      let result = null
      let polls = 0
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 8000))
        polls++
        const pollRes = await fetch(`/api/influencers/sync-instagram?runId=${runId}`)
        const pollJson = await pollRes.json()
        if (!pollRes.ok) throw new Error(pollJson.error ?? 'Error consultando sync')
        if (pollJson.status === 'SUCCEEDED') { result = pollJson; break }
        if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(pollJson.status)) {
          throw new Error(`Apify terminó con error: ${pollJson.status}`)
        }
        // Show progress every 3 polls (~24s)
        if (polls % 3 === 0) toast.info(`Sincronizando… (${Math.round(polls * 8)}s)`, { id: 'sync-progress' })
      }
      if (!result) throw new Error('Timeout: sincronización tardó más de 5 minutos')

      const msg = `✅ ${result.synced} actualizados${result.failed ? ` · ${result.failed} sin datos` : ''}${result.errors?.length ? ` · Ver consola` : ''}`
      toast.success(msg, { duration: 8000 })
      if (result.errors?.length) console.warn('[sync-ig] errors:', result.errors)
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
          {/* KPIs */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Database} label="Total influencers" value={report.total} tone="violet" />
              <StatCard icon={Users} label="Activos / Inactivos" value={`${report.active} / ${report.inactive}`} tone="blue" />
              <StatCard icon={Instagram} label="Sin Instagram" value={report.withoutInstagram} tone="amber" />
              <StatCard icon={AlertTriangle} label="Registros duplicados" value={report.duplicateRecords} tone="red" />
            </div>
          )}

          {/* Desglose duplicados */}
          {report && (
            <div className="card p-5">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Duplicados por tipo</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: Mail, label: 'Por email', value: report.duplicatesByEmail },
                  { icon: Instagram, label: 'Por Instagram URL', value: report.duplicatesByInstagramUrl },
                  { icon: Instagram, label: 'Por Instagram @', value: report.duplicatesByInstagram },
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

          {!isAdmin && (
            <div className="card p-4 flex items-center gap-3 border-amber-200 bg-amber-50/40 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              Solo administradores pueden combinar o eliminar registros permanentemente. Tienes vista de solo lectura.
            </div>
          )}

          {/* Acción: eliminar sin Instagram */}
          {isAdmin && report && report.withoutInstagram > 0 && (
            <div className="card p-5 flex items-center justify-between border-amber-200 bg-amber-50/40">
              <div className="flex items-center gap-3">
                <Instagram className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{report.withoutInstagram} influencer(s) sin Instagram</p>
                  <p className="text-xs text-gray-500">Instagram es el identificador obligatorio. Elimínalos antes de importar.</p>
                </div>
              </div>
              <button onClick={handleDeleteNoInstagram} disabled={busy === 'no-instagram'}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50">
                {busy === 'no-instagram' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Eliminar sin Instagram
              </button>
            </div>
          )}

          {/* Duplicados */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
              Duplicados detectados ({groups.length} grupo{groups.length !== 1 ? 's' : ''})
            </h3>
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
