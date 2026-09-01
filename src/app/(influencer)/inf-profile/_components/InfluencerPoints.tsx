import { AlertCircle, ArrowDown, ArrowUp, History, Trophy } from 'lucide-react'

export type InfluencerPointsData = {
  score: number
  activity: {
    completed_campaigns: number
    on_time_campaigns: number
    attendances: number
    cancellations: number
    breaches: number
  }
  movements: Array<{
    id: string
    points: number
    label: string
    campaign: string
    date: string
  }>
  unavailable_rules: string[]
}

const POSITIVE_RULES = [
  ['Postular a una campaña', '+1'],
  ['Ser aprobada', '0'],
  ['Confirmar asistencia a tiempo', '+10'],
  ['Confirmar y asistir', '+10'],
  ['Asistir al evento', '+10'],
  ['Entregar contenido a tiempo', '+30'],
  ['Completar todos los entregables', '+20'],
  ['Publicar Story requerido', '+5'],
]

const NEGATIVE_RULES = [
  ['No confirmar asistencia', '-5'],
  ['Confirmar y no asistir', '-40'],
  ['No confirmar y no asistir', '-50'],
  ['No confirmar, pero asistir', '-5'],
  ['Cancelar avisando con anticipación', '-2'],
  ['Cancelar con poco tiempo', '-10'],
  ['Entregar contenido tarde', '-20'],
  ['No entregar contenido', '-60'],
]

export function InfluencerPoints({ data }: { data: InfluencerPointsData | null }) {
  if (!data) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">No pudimos calcular tus puntos en este momento.</div>
  }

  const activity = [
    ['Campañas completadas', data.activity.completed_campaigns],
    ['Campañas entregadas a tiempo', data.activity.on_time_campaigns],
    ['Asistencias', data.activity.attendances],
    ['Cancelaciones', data.activity.cancellations],
    ['Incumplimientos', data.activity.breaches],
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-100"><Trophy className="h-4 w-4" /> SCENCE Score</div>
        <p className="mt-2 text-4xl font-black">{data.score.toLocaleString('es-CL')} <span className="text-lg font-semibold text-violet-100">puntos</span></p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><ArrowUp className="h-4 w-4 text-emerald-600" /> Así ganas puntos</h2>
          <div className="mt-3 divide-y divide-gray-50">
            {POSITIVE_RULES.map(([label, points]) => <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm"><span className="text-gray-600">{label}</span><strong className="text-emerald-600">{points}</strong></div>)}
          </div>
        </section>
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><ArrowDown className="h-4 w-4 text-rose-600" /> Así pierdes puntos</h2>
          <div className="mt-3 divide-y divide-gray-50">
            {NEGATIVE_RULES.map(([label, points]) => <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm"><span className="text-gray-600">{label}</span><strong className="text-rose-600">{points}</strong></div>)}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-900">Tu actividad</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {activity.map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3"><p className="text-xl font-black text-gray-900">{value}</p><p className="mt-1 text-xs leading-tight text-gray-500">{label}</p></div>)}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><History className="h-4 w-4 text-gray-400" /> Tus últimos movimientos</h2>
        {data.movements.length === 0 ? <p className="mt-4 text-sm text-gray-500">Tus movimientos aparecerán aquí cuando participes en campañas.</p> : (
          <div className="mt-3 divide-y divide-gray-50">
            {data.movements.map(movement => <div key={movement.id} className="flex items-start gap-3 py-3">
              <span className={`min-w-11 rounded-lg px-2 py-1 text-center text-xs font-black ${movement.points >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{movement.points > 0 ? '+' : ''}{movement.points}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-gray-800">{movement.label}</p><p className="truncate text-xs text-gray-500">{movement.campaign}</p></div>
              <time className="hidden text-xs text-gray-400 sm:block">{new Date(movement.date).toLocaleDateString('es-CL')}</time>
            </div>)}
          </div>
        )}
      </section>

      {data.unavailable_rules.length > 0 && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Las cancelaciones anticipadas o tardías se muestran en la tabla, pero todavía no alteran el Score porque las campañas actuales no guardan un límite objetivo para distinguirlas.</p></div>}
    </div>
  )
}
