'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { cn, formatDatetime } from '@/lib/utils'
import { toast } from 'sonner'
import type { JobReport } from '@/lib/crm-send-guard'
import { JOB_STATUS } from '../EnviosClient'

const RESOLUTION_LABEL: Record<string, string> = {
  provider_activity_seen: 'Resend registró actividad después de la reserva',
  no_provider_evidence: 'Sin evidencia del proveedor',
}

const CONFIRM_WORD = 'REANUDAR'

export function JobDetailClient({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<JobReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [resuming, setResuming] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const r = await fetch(`/api/crm-leads/bulk-send/jobs/${jobId}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar el envío')
      setReport(j.data as JobReport)
    } catch (e) {
      setReport(null)
      setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el envío')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => { void load() }, [load])

  async function resume() {
    if (!report) return
    if (confirmText.trim() !== CONFIRM_WORD) { toast.error(`Debes escribir ${CONFIRM_WORD}`); return }
    setResuming(true)
    try {
      const r = await fetch(`/api/crm-leads/bulk-send/jobs/${jobId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // La huella es la de lo que el administrador está viendo: si el estado cambió, el servidor rechaza.
        body: JSON.stringify({ confirm: true, expected_fingerprint: report.fingerprint }),
      })
      const j = await r.json()
      if (!r.ok) {
        if (j.code === 'stale_state') toast.error('El estado del envío cambió. Revisa los datos actualizados antes de reanudar.')
        else toast.error(j.error ?? 'No se pudo reanudar el envío')
        setShowModal(false)
        setConfirmText('')
        await load()
        return
      }
      const decided = (j.data?.interrupted_attempts ?? []).length
      toast.success(decided === 0
        ? 'Envío reanudado.'
        : decided === 1
          ? 'Envío reanudado. 1 intento interrumpido quedó registrado como no confirmado (no se reenvía).'
          : `Envío reanudado. ${decided} intentos interrumpidos quedaron registrados como no confirmados (no se reenvían).`)
      setShowModal(false)
      setConfirmText('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo reanudar el envío')
    } finally {
      setResuming(false)
    }
  }

  const st = report ? (JOB_STATUS[report.job.status] ?? { label: report.job.status, cls: 'bg-gray-100 text-gray-600' }) : null
  const pct = report && report.job.total > 0 ? Math.min(100, Math.round((report.job.cursor / report.job.total) * 100)) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/admin-crm/envios" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 mb-1">
            <ArrowLeft className="h-3 w-3" /> Envíos masivos
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Envío masivo <span className="font-mono text-base text-gray-400">{jobId.slice(0, 8)}</span></h1>
          {report && st && (
            <p className="text-sm text-gray-400 mt-0.5">
              <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold mr-2', st.cls)}>{st.label}</span>
              Creado {formatDatetime(report.job.created_at)} · último avance {formatDatetime(report.job.updated_at)}
            </p>
          )}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Actualizar
        </button>
      </div>

      {loading && !report ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
      ) : report && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-500">Avance</span>
              <span className="tabular-nums font-semibold text-gray-800">{report.job.cursor.toLocaleString('es-CL')} / {report.job.total.toLocaleString('es-CL')} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Confirmados" value={report.counts.confirmed} hint="Resend aceptó el correo" tone="ok" />
            <Stat label="Fallidos definitivos" value={report.counts.definitiveFailed} hint="El correo NO salió" />
            <Stat label="Inciertos registrados" value={report.counts.uncertainRecorded} hint="Pueden haber salido; revisar en Resend" tone="warn" />
            <Stat label="Interrumpidos por decidir" value={report.interrupted.length} hint="Reservados sin resultado" tone={report.interrupted.length ? 'warn' : undefined} />
            <Stat label="Pendientes" value={report.job.remaining} hint="Aún sin procesar" />
          </div>

          {report.blockers.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" /> Este envío no se puede reanudar ahora</p>
              <ul className="list-disc pl-6 text-sm text-amber-800 space-y-0.5">
                {report.blockers.map((b, i) => <li key={i}>{b.message}</li>)}
              </ul>
              {report.blockers.some(b => b.code === 'manual_review') && (
                <p className="text-xs text-amber-700 pt-1">Revisa a mano en Resend qué correos salieron antes de decidir cómo continuar. No se tomará ninguna decisión automática.</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Intentos interrumpidos</h2>
              <p className="text-xs text-gray-400">Contactos reservados cuyo envío quedó a medias. Al reanudar se registran como <b>no confirmados</b> y <b>no se reenvían automáticamente</b>, tengan o no evidencia del proveedor.</p>
            </div>
            {report.interrupted.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No hay intentos interrumpidos en la tanda actual.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-semibold">Contacto</th>
                    <th className="px-4 py-2 font-semibold">Reservado</th>
                    <th className="px-4 py-2 font-semibold">Evidencia</th>
                  </tr>
                </thead>
                <tbody>
                  {report.interrupted.map(item => (
                    <tr key={item.leadId} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2"><Link href={`/admin-crm/${item.leadId}`} className="font-mono text-xs text-violet-600 hover:underline">{item.leadId.slice(0, 8)}</Link></td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatDatetime(item.claimedAt)}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {RESOLUTION_LABEL[item.resolution] ?? item.resolution}
                        {item.evidence.length > 0 && <span className="text-xs text-gray-400"> · {item.evidence.length} evento{item.evidence.length === 1 ? '' : 's'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            {!report.resumable && <span className="text-xs text-gray-400">Reanudación no disponible</span>}
            <button type="button" disabled={!report.resumable} onClick={() => { setConfirmText(''); setShowModal(true) }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Play className="h-4 w-4" /> Reanudar envío
            </button>
          </div>
        </>
      )}

      {showModal && report && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Reanudar envío masivo</h2>
                <p className="text-xs text-amber-600 font-semibold">Quedará registrado quién lo hizo y cuándo.</p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
                <li>El envío continúa desde el contacto {report.job.cursor.toLocaleString('es-CL')} de {report.job.total.toLocaleString('es-CL')} ({report.job.remaining.toLocaleString('es-CL')} pendientes).</li>
                <li>
                  {report.interrupted.length > 0
                    ? report.interrupted.length === 1
                      ? <><b>1</b> intento interrumpido se registrará como <b>no confirmado</b> y <b>no se reenviará</b>.</>
                      : <><b>{report.interrupted.length}</b> intentos interrumpidos se registrarán como <b>no confirmados</b> y <b>no se reenviarán</b>.</>
                    : 'No hay intentos interrumpidos que decidir.'}
                </li>
                <li>Los correos ya confirmados no se vuelven a enviar. Nadie recibe el mismo correo dos veces desde este envío.</li>
                <li>Los contactos dados de baja siguen excluidos.</li>
              </ul>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Escribe {CONFIRM_WORD} para confirmar</label>
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-violet-400" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={() => void resume()} disabled={resuming || confirmText.trim() !== CONFIRM_WORD}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  {resuming && <Loader2 className="h-4 w-4 animate-spin" />} Reanudar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900')}>{value.toLocaleString('es-CL')}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>
    </div>
  )
}
