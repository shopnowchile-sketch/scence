'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

interface Props {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}

export default function CommuneMultiSelect({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.toLowerCase().includes(q)) : options
  }, [options, query])

  const label = selected.length === 0
    ? 'Todas las comunas'
    : selected.length === 1 ? selected[0] : `${selected.length} comunas`

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(s => s !== value) : [...selected, value])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Filtrar por comunas"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="h-9 min-w-[160px] max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 outline-none focus:border-violet-400 flex items-center justify-between gap-2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100 relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar comuna…"
              className="h-8 w-full pl-7 pr-2 rounded-lg border border-gray-200 text-xs outline-none focus:border-violet-400"
            />
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-xs text-violet-600 hover:bg-violet-50 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Limpiar selección ({selected.length})
            </button>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">Sin resultados</li>}
            {filtered.map(value => (
              <li key={value}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={() => toggle(value)}
                    className="accent-violet-600"
                  />
                  <span className="truncate">{value}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
