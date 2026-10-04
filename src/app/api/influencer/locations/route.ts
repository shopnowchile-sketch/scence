import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

// Public, read-only geography picker. Only canonical country/region/city/commune
// nodes are exposed; private places are never returned.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const params = new URL(req.url).searchParams
  const q = (params.get('q') ?? '').trim()
  const id = (params.get('id') ?? '').trim()

  const { data: locations, error } = await fetchAllRows(
    (from, to) => admin
      .from('locations')
      .select('id, name, parent_id, level')
      .eq('is_active', true)
      .neq('level', 'place')
      .range(from, to),
    { maxRows: 5000 }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  const normalizedQ = normalize(q)
  const filtered = normalizedQ
    ? data.filter(row => normalize([row.name, row.city, row.region, row.country].filter(Boolean).join(' ')).includes(normalizedQ))
    : data

  return NextResponse.json({ data: filtered.slice(0, 100) })
}
