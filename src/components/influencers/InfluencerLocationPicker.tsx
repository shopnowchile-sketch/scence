'use client'

import { useEffect, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export type InfluencerLocation = {
  id: string
  name: string
  city: string | null
  region: string | null
  country: string | null
  level: 'country' | 'region' | 'city' | 'commune'
  breadcrumb?: string
}

export function InfluencerLocationPicker({
  value,
  onChange,
  required = false,
}: {
  value: string
  onChange: (location: InfluencerLocation | null) => void
  required?: boolean
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<InfluencerLocation[]>([])
  const [selected, setSelected] = useState<InfluencerLocation | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/influencer/locations?q=' + encodeURIComponent(query), { cache: 'no-store' })
        const json = await res.json()
        if (!cancelled) setOptions(json.data ?? [])
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    fetch('/api/influencer/locations?id=' + encodeURIComponent(value), { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        const found = (j.data ?? []).find((row: InfluencerLocation) => row.id === value)
        if (found) setSelected(found)
      })
      .catch(() => {})
  }, [value])

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        Ubicación {required && <span className="text-red-500">*</span>}
      </label>

      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 text-violet-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-violet-900">{selected.name}</p>
              <p className="text-xs text-violet-600 truncate">{selected.breadcrumb ?? [selected.city, selected.region, selected.country].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setSelected(null); onChange(null) }} className="text-xs font-medium text-violet-700 hover:text-violet-900">
            Cambiar
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar país, región, ciudad o comuna…"
            className="input-base w-full pl-9"
          />
          {(loading || options.length > 0) && (
            <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
              {loading && <p className="px-3 py-2 text-xs text-gray-400">Buscando…</p>}
              {!loading && options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => { setSelected(option); setQuery(''); setOptions([]); onChange(option) }}
                  className={cn('w-full text-left px-3 py-2.5 hover:bg-violet-50 flex items-center gap-2')}
                >
                  <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800">{option.name}</span>
                    <span className="block text-xs text-gray-400">{option.breadcrumb ?? [option.city, option.region, option.country].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
