import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// Authenticated, read-only geography picker for influencer profile/admin forms.
// Only exposes country/region/city/commune names — never private places.
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const params = new URL(req.url).searchParams
  const q = (params.get('q') ?? '').trim()
  const id = (params.get('id') ?? '').trim()

  const { data: communes, error: communeError } = await admin
    .from('locations')
    .select('id, name, parent_id')
    .eq('level', 'commune')
    .eq('is_active', true)
    .order('name')

  if (communeError) return NextResponse.json({ error: communeError.message }, { status: 500 })

  const parentIds = Array.from(new Set((communes ?? []).map(c => c.parent_id).filter(Boolean)))
  const { data: parents, error: parentError } = parentIds.length
    ? await admin.from('locations').select('id, name, level, parent_id').in('id', parentIds)
    : { data: [], error: null }

  if (parentError) return NextResponse.json({ error: parentError.message }, { status: 500 })

  const parentRows = parents ?? []
  const regionIds = Array.from(new Set(parentRows.map(p => p.level === 'region' ? p.id : p.parent_id).filter(Boolean)))
  const { data: regions, error: regionError } = regionIds.length
    ? await admin.from('locations').select('id, name, level, parent_id').in('id', regionIds)
    : { data: [], error: null }

  if (regionError) return NextResponse.json({ error: regionError.message }, { status: 500 })

  const countryIds = Array.from(new Set((regions ?? []).map(r => r.parent_id).filter(Boolean)))
  const { data: countries, error: countryError } = countryIds.length
    ? await admin.from('locations').select('id, name, level, parent_id').in('id', countryIds)
    : { data: [], error: null }

  if (countryError) return NextResponse.json({ error: countryError.message }, { status: 500 })

  const byId = new Map<string, { id: string; name: string; level: string; parent_id: string | null }>()
  for (const row of [...parentRows, ...(regions ?? []), ...(countries ?? [])]) byId.set(row.id, row)

  const data = (communes ?? []).map(c => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null
    const region = parent?.level === 'region' ? parent : parent?.parent_id ? byId.get(parent.parent_id) : null
    const country = region?.parent_id ? byId.get(region.parent_id) : null
    return {
      id: c.id,
      name: c.name,
      city: parent?.level === 'city' ? parent.name : null,
      region: region?.name ?? null,
      country: country?.name ?? null,
    }
  })

  const normalize = (value: string) => value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

  if (id) {
    return NextResponse.json({ data: data.filter(row => row.id === id) })
  }

  const normalizedQ = normalize(q)
  const filtered = normalizedQ
    ? data.filter(row => normalize([row.name, row.city, row.region, row.country].filter(Boolean).join(' ')).includes(normalizedQ))
    : data

  return NextResponse.json({ data: filtered })
}
