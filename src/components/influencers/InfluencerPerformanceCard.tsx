'use client'

// Desempeño interno compacto para la ficha (solo Admin). Todo viene de /api/influencers/[id]/performance,
// que calcula desde asistencias y entregables reales; sin datos no se muestra ningún puntaje.
import { useEffect, useState } from 'react'
import type { PerformanceHistoryItem, PerformanceSummary } from '@/lib/influencer-performance'

const KIND: Record<PerformanceHistoryItem['kind'], { label: string; cls: string }> = {
  attended: { label: 'Asistió', cls: 'badge-green' },
  excused: { label: 'Avisó que no asistía', cls: 'badge-orange' },
  no_show: { label: 'No asistió (sin aviso)', cls: 'badge-red' },
  on_time: { label: 'Entregó a tiempo', cls: 'badge-green' },
  late: { label: 'Entregó con atraso', cls: 'badge-orange' },
  overdue: { label: 'Entregable atrasado', cls: 'badge-red' },
}

export function InfluencerPerformanceCard({ influencerId, rating }: { influencerId: string; rating: number | null }) {
  const [data, setData] = useState<{ summary: PerformanceSummary; history: PerformanceHistoryItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/influencers/${influencerId}/performance`, { credentials: 'same-origin' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!alive) return; if (ok) setData(j.data); else setError(j.error ?? 'No se pudo cargar') })
      .catch(() => { if (alive) setError('No se pudo cargar') })
    return () => { alive = false }
  }, [influencerId])

  if (error) return <div className="card p-5 text-sm text-red-500">Desempeño: {error}</div>
  if (!data) return <div className="card p-5 text-sm text-gray-400">Cargando desempeño…</div>
  const { summary: s, history } = data
  const stats: { label: string; value: string | number; hint?: string }[] = [
    { label: 'Rating SCENCE', value: rating && rating > 0 ? rating.toFixed(1) : '—' },
    { label: 'Cumplimiento', value: s.compliance == null ? '—' : `${s.compliance}%`, hint: 'asistencia + entregables' },
    { label: 'Campañas realizadas', value: s.campaigns_completed, hint: `${s.campaigns_participated} con participación` },
    { label: 'Asistió', value: s.attendance.attended },
    { label: 'Avisó que no iba', value: s.attendance.excused, hint: 'cancelación' },
    { label: 'No asistió', value: s.attendance.no_show, hint: 'sin aviso' },
    { label: 'Entregables completados', value: s.deliverables.completed, hint: `${s.deliverables.on_time} a tiempo` },
    { label: 'Pendientes', value: s.deliverables.pending, hint: 'dentro de plazo' },
    { label: 'Atrasados', value: s.deliverables.overdue + s.deliverables.late, hint: `${s.deliverables.overdue} sin entregar` },
  ]
  return (
    <div className="card p-5" data-testid="influencer-performance">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Desempeño interno</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {stats.map(m => (
          <div key={m.label}>
            <div className="text-lg font-bold text-gray-900">{m.value}</div>
            <div className="text-xs text-gray-500">{m.label}</div>
            {m.hint && <div className="text-[10px] text-gray-400">{m.hint}</div>}
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-500 mb-2">Historial de cumplimiento</p>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400">Aún sin compromisos resueltos.</p>
        ) : (
          <ul className="space-y-1.5 max-h-48 overflow-auto">
            {history.map((h, i) => (
              <li key={`${h.campaign_id}-${h.date}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-gray-400 flex-shrink-0">{h.date}</span>
                <span className={`badge ${KIND[h.kind].cls} text-[10px]`}>{KIND[h.kind].label}</span>
                <span className="truncate text-gray-600">{h.campaign_name ?? 'Campaña'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
