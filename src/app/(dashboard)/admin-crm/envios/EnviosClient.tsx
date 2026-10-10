'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { cn, formatDatetime } from '@/lib/utils'
import { toast } from 'sonner'

export type BulkJobRow = {
  id: string; status: string; subject: string; template_key: string
  total: number; cursor: number; sent: number; skipped: number; failed: number
  created_at: string; updated_at: string; completed_at: string | null
  busy: boolean; note: string | null; reviewable: boolean
}

export const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Pendiente',   cls: 'bg-amber-50 text-amber-700' },
  processing: { label: 'En proceso',  cls: 'bg-sky-50 text-sky-700' },
  completed:  { label: 'Completado',  cls: 'bg-emerald-50 text-emerald-700' },
  failed:     { label: 'Cerrado / fallido', cls: 'bg-gray-100 text-gray-600' },
}

export function EnviosClient() {
  const [jobs, setJobs] = useState<BulkJobRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/crm-leads/bulk-send/jobs')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se pudieron cargar los envíos')
      setJobs(j.data as BulkJobRow[])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los envíos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/admin-crm" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 mb-1">
            <ArrowLeft className="h-3 w-3" /> CRM
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Envíos masivos</h1>
          <p className="text-sm text-gray-400">Últimos 30 envíos. Revisa un envío interrumpido antes de reanudarlo.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Actualizar
        </button>
      </div>

      {loading && !jobs ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : !jobs?.length ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">Todavía no hay envíos masivos.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3 font-semibold">Creado</th>
                <th className="px-4 py-3 font-semibold">Asunto</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold text-right">Avance</th>
                <th className="px-4 py-3 font-semibold text-right">Enviados</th>
                <th className="px-4 py-3 font-semibold text-right">Omitidos</th>
                <th className="px-4 py-3 font-semibold text-right">Fallidos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const st = JOB_STATUS[job.status] ?? { label: job.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={job.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{formatDatetime(job.created_at)}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-medium text-gray-800 truncate" title={job.subject}>{job.subject}</p>
                      {job.note && <p className="text-xs text-gray-400 truncate" title={job.note}>{job.note}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', st.cls)}>{st.label}</span>
                      {job.busy && <span className="ml-1 text-xs text-sky-600">· procesando ahora</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{job.cursor.toLocaleString('es-CL')} / {job.total.toLocaleString('es-CL')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{job.sent.toLocaleString('es-CL')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{job.skipped.toLocaleString('es-CL')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{job.failed.toLocaleString('es-CL')}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={`/admin-crm/envios/${job.id}`} className="text-violet-600 font-semibold hover:underline">
                        {job.reviewable ? 'Revisar' : 'Ver'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
