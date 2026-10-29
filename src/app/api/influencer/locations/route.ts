import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

// Next.js 14 can prerender GET Route Handlers that appear cacheable. This endpoint
// reads the database per request and must never run during static generation.
export const dynamic = 'force-dynamic'

// Public, read-only geography picker. Only canonical country/region/city/commune
// nodes are exposed; private places are never returned.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const params = new URL(req.url).searchParams
  const q = (params.get('q') ?? '').trim()
  const id = (params.get('id') ?? '').trim()
  const level = (params.get('level') ?? '').trim()
  const parent = (params.get('parent') ?? '').trim()
  const ancestors = (params.get('ancestors') ?? '').trim()

  const { data: locations, error } = await fetchAllRows(
    (from, to) => admin
      .from('locations')
      .select('id, name, parent_id, level')
      .eq('is_active', true)
      .neq('level', 'place')
      .range(from, to),
    { maxRows: 5000 }
  )

  if (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar las ubicaciones'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const rows = (locations ?? []) as Array<{
    id: string
    name: string
    parent_id: string | null
    level: 'country' | 'region' | 'city' | 'commune'
  }>
  const byId = new Map(rows.map(row => [row.id, row]))

  const normalize = (value: string) => value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

  const data = rows.map(location => {
    let current: typeof location | undefined = location
    let country: string | null = null
    let region: string | null = null
    let city: string | null = null
    let commune: string | null = null
    const visited = new Set<string>()

    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (current.level === 'country') country = current.name
      if (current.level === 'region') region = current.name
      if (current.level === 'city') city = current.name
      if (current.level === 'commune') commune = current.name
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }

    return {
      id: location.id,
      name: location.name,
      level: location.level,
      city,
      region,
      country,
      breadcrumb: [commune, city, region, country].filter(Boolean).join(' · '),
    }
  })

  if (id) return NextResponse.json({ data: data.filter(row => row.id === id) })

  // Selectores dependientes: hijos directos de un nodo ('root' = países) y cadena de ancestros.
  if (parent) {
    const children = rows
      .filter(row => (parent === 'root' ? row.level === 'country' : row.parent_id === parent))
      .map(row => ({ id: row.id, name: row.name, level: row.level }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return NextResponse.json({ data: children })
  }
  if (ancestors) {
    const chain: Array<{ id: string; name: string; level: string }> = []
    let current = byId.get(ancestors)
    while (current && chain.length < 6) {
      chain.unshift({ id: current.id, name: current.name, level: current.level })
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
    return NextResponse.json({ data: chain })
  }

  if (level === 'country') return NextResponse.json({ data: data.filter(row => row.level === 'country') })

  const normalizedQ = normalize(q)
  const filtered = normalizedQ
    ? data.filter(row => normalize([row.name, row.city, row.region, row.country].filter(Boolean).join(' ')).includes(normalizedQ))
    : data

  return NextResponse.json({ data: filtered.slice(0, 100) })
}
