'use client'

import { useEffect, useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import {
  DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, EXPORT_FILTERS, EXPORT_FILTER_LABELS, EXPORT_FORMATS, parseExportColumns,
  type ExportFilter, type ExportFormat,
} from '@/lib/campaign-export-columns'

// Selector de columnas, filtro (aprobadas / confirmadas / ambas) y formato (Excel / CSV) de la descarga de influencers.
// Solo se muestra al Super Admin; la autorización la decide el servidor (403 para cualquier otro).
// La última selección se recuerda por navegador (localStorage, solo conveniencia: nunca es fuente de verdad).
const STORAGE_KEY = 'scence.campaign-export.v1'

function readSaved(): { columns: string; filter: ExportFilter; format: ExportFormat } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function ExportInfluencersMenu({ campaignId }: { campaignId: string }) {
  const available = EXPORT_COLUMNS
  const [open, setOpen] = useState(false)
  const [columns, setColumns] = useState<string[]>(DEFAULT_EXPORT_COLUMNS)
  const [filter, setFilter] = useState<ExportFilter>('confirmed')
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = readSaved()
    if (!saved) return
    const allowed = new Set(available.map(column => column.key as string))
    const restored = parseExportColumns(saved.columns).filter(key => allowed.has(key))
    if (restored.length > 0) setColumns(restored)
    if ((EXPORT_FILTERS as readonly string[]).includes(saved.filter)) setFilter(saved.filter)
    if ((EXPORT_FORMATS as readonly string[]).includes(saved.format)) setFormat(saved.format)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (key: string) => setColumns(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  const href = `/api/campaigns/${campaignId}/influencers/export?${new URLSearchParams({ filter, format, columns: columns.join(',') })}`
  const remember = () => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: columns.join(','), filter, format })) } catch { /* opcional */ }
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title="Descargar influencers"
        aria-label="Descargar influencers"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 transition-colors hover:bg-emerald-100"
      >
        <FileDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl">
          <p className="text-sm font-bold text-gray-900">Exportar influencers</p>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-500">Incluir</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPORT_FILTERS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === option ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-200 text-gray-600 hover:border-violet-300'}`}
                >
                  {EXPORT_FILTER_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-500">Columnas</p>
            <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto pr-1">
              {available.map(column => (
                <label key={column.key} className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggle(column.key)} className="accent-violet-600" />
                  {column.label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">{columns.length} columna{columns.length === 1 ? '' : 's'} seleccionada{columns.length === 1 ? '' : 's'}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
              {EXPORT_FORMATS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFormat(option)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${format === option ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
                >
                  {option === 'xlsx' ? 'Excel' : 'CSV'}
                </button>
              ))}
            </div>
            {columns.length === 0 ? (
              <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-400">Descargar</span>
            ) : (
              <a href={href} download onClick={remember} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">Descargar</a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
