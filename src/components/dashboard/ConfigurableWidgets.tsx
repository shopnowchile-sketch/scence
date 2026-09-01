'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type DashboardWidgetDefinition = {
  id: string
  label: string
  value: string | number
  subtitle?: string
  href?: string
  tone?: 'violet' | 'blue' | 'amber' | 'green' | 'gray'
  filterLabel?: string
  filterOptions?: Array<{ value: string; label: string }>
  valueForFilter?: (filter: string) => string | number
}

type SavedWidget = { id: string; filter?: string }
type Portal = 'admin' | 'brand' | 'influencer'

const TONES = {
  violet: 'bg-violet-50 text-violet-700',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
  gray: 'bg-gray-100 text-gray-700',
}

export function ConfigurableWidgets({
  portal,
  available,
  defaults,
}: {
  portal: Portal
  available: DashboardWidgetDefinition[]
  defaults: string[]
}) {
  const [widgets, setWidgets] = useState<SavedWidget[]>(defaults.map(id => ({ id })))
  const [allSaved, setAllSaved] = useState<Record<string, SavedWidget[]>>({})
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/settings/profile', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(json => {
        if (!active) return
        const saved = json?.data?.metadata?.dashboard_widgets
        if (!saved || typeof saved !== 'object') return
        setAllSaved(saved)
        if (Array.isArray(saved[portal])) setWidgets(saved[portal])
      })
      .catch(() => {})
    return () => { active = false }
  }, [portal])

  const definitions = useMemo(
    () => new Map(available.map(item => [item.id, item])),
    [available],
  )

  async function save(next: SavedWidget[]) {
    const previous = widgets
    setWidgets(next)
    const dashboardWidgets = { ...allSaved, [portal]: next }
    setAllSaved(dashboardWidgets)
    const response = await fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboard_widgets: dashboardWidgets }),
    })
    if (!response.ok) {
      setWidgets(previous)
      toast.error('No se pudo guardar la configuración de widgets')
    }
  }

  const remaining = available.filter(definition => !widgets.some(widget => widget.id === definition.id))

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">Widgets y reportes</h2>
        {remaining.length > 0 && (
          <button type="button" onClick={() => setAdding(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50">
            <Plus className="h-3.5 w-3.5" /> Agregar widget
          </button>
        )}
      </div>
      {adding && remaining.length > 0 && (
        <div className="flex max-w-md items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <select id={`${portal}-widget-add`} defaultValue="" className="input-base flex-1 text-sm">
            <option value="" disabled>Selecciona un dato</option>
            {remaining.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" onClick={() => {
            const select = document.getElementById(`${portal}-widget-add`) as HTMLSelectElement | null
            if (!select?.value) return
            void save([...widgets, { id: select.value }])
            setAdding(false)
          }} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700">Agregar</button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {widgets.flatMap((widget, index) => {
          const definition = definitions.get(widget.id)
          if (!definition) return []
          const value = definition.valueForFilter && widget.filter
            ? definition.valueForFilter(widget.filter)
            : definition.value
          return [(
            <div key={widget.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TONES[definition.tone ?? 'violet'])}><BarChart3 className="h-5 w-5" /></div>
                <button type="button" onClick={() => void save(widgets.filter((_, itemIndex) => itemIndex !== index))} title="Eliminar widget" aria-label={`Eliminar ${definition.label}`} className="rounded-lg p-1.5 text-gray-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-3 text-2xl font-bold text-gray-900">{value}</div>
              {definition.href
                ? <Link href={definition.href} className="mt-0.5 block text-sm font-medium text-gray-600 hover:text-violet-700">{definition.label}</Link>
                : <div className="mt-0.5 text-sm font-medium text-gray-600">{definition.label}</div>}
              {definition.subtitle && <div className="mt-1 text-xs text-gray-400">{definition.subtitle}</div>}
              {definition.filterOptions && definition.filterOptions.length > 0 && (
                <label className="mt-3 block text-[11px] font-semibold text-gray-400">
                  {definition.filterLabel ?? 'Filtrar'}
                  <select value={widget.filter ?? ''} onChange={event => void save(widgets.map((item, itemIndex) => itemIndex === index ? { ...item, filter: event.target.value || undefined } : item))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700">
                    <option value="">Todos</option>
                    {definition.filterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )]
        })}
      </div>
      {widgets.length === 0 && <p className="rounded-xl border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-400">Agrega un widget para ver tus datos principales.</p>}
    </section>
  )
}
