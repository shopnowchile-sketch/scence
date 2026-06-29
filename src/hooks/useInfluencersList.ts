import { useQuery } from '@tanstack/react-query'
import type { Influencer } from '@/types'

interface Params {
  search?: string
  platform?: string
  category?: string
  country?: string
  verified?: boolean
  isActive?: boolean
  statusFilter?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  limit?: number
}

async function fetchInfluencers(params: Params): Promise<{ data: Influencer[]; total: number }> {
  const sp = new URLSearchParams()
  if (params.search)   sp.set('search', params.search)
  if (params.platform) sp.set('platform', params.platform)
  if (params.category) sp.set('category', params.category)
  if (params.country)  sp.set('country', params.country)
  if (params.verified) sp.set('verified', 'true')
  if (params.statusFilter && params.statusFilter !== 'all') {
    sp.set('status_filter', params.statusFilter)
  } else {
    if (params.isActive === true)  sp.set('is_active', 'true')
    if (params.isActive === false) sp.set('is_active', 'false')
  }
  if (params.sortBy)   sp.set('sort_by', params.sortBy)
  if (params.sortDir)  sp.set('sort_dir', params.sortDir)
  if (params.page)     sp.set('page', String(params.page))
  if (params.limit)    sp.set('limit', String(params.limit))

  const res = await fetch(`/api/influencers?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar influencers')
  return res.json()
}

export function useInfluencersList(params: Params = {}) {
  return useQuery({
    queryKey: ['influencers', params],
    queryFn:  () => fetchInfluencers(params),
  })
}

async function fetchInfluencer(id: string): Promise<{ data: Influencer }> {
  const res = await fetch(`/api/influencers/${id}`)
  if (!res.ok) throw new Error('Influencer no encontrado')
  return res.json()
}

export function useInfluencer(id: string) {
  return useQuery({
    queryKey: ['influencer', id],
    queryFn:  () => fetchInfluencer(id),
    enabled:  !!id,
  })
}
