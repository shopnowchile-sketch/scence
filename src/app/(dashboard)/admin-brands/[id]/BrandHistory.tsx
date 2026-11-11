'use client'

import { useEffect, useState } from 'react'

type Event = {
  id: string
  label: string
  campaign: string | null
  actor: string | null
  at: string
}

const activityDate = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Santiago',
})

export default function BrandHistory({ brandId, lastSeen }: { brandId: string; lastSeen?: string | null }) {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    fetch(`/api/brands/${brandId}?view=history`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Historial no disponible')
        const { data } = await response.json()
        if (!controller.signal.aborted) setEvents(data)
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [brandId, refresh])

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">Actividad del portal</h2>
          {lastSeen && <p className="mt-1 text-sm text-gray-500">Última conexión registrada · {activityDate.format(new Date(lastSeen))}</p>}
        </div>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-violet-700 disabled:opacity-50">
          Actualizar
        </button>
      </div>
      {loading && <p className="mt-4 text-sm text-gray-500" role="status">Cargando actividad…</p>}
      {failed && <p className="mt-4 text-sm text-red-600" role="alert">No pudimos cargar el historial. Intenta actualizar.</p>}
      {!loading && !failed && events.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">Aún no hay actividad registrada desde que se habilitó el historial.</p>
      )}
      {!loading && !failed && events.length > 0 && (
        <ol className="mt-3 divide-y divide-gray-100">
          {events.map(event => (
            <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm">
              <div className="min-w-0 break-words">
                <p className="font-medium text-gray-900">{event.label}{event.campaign && ` · ${event.campaign}`}</p>
                {event.actor && <p className="text-gray-500">{event.actor}</p>}
              </div>
              <time className="text-gray-500" dateTime={event.at}>{activityDate.format(new Date(event.at))}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
