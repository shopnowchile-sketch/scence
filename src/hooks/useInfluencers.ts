'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Influencer, InfluencerFilters } from '@/types'
import { DEFAULT_INFLUENCER_FILTERS, getInfluencerTier } from '@/types'

export const INFLUENCERS_PAGE_SIZE = 48

export function useInfluencers(_orgId?: string, apiBase = '/api/influencers') {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [dbTotal, setDbTotal]         = useState(0)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [filters, setFilters]         = useState<InfluencerFilters>(DEFAULT_INFLUENCER_FILTERS)
  const [view, setView]               = useState<'grid' | 'list' | 'ranking'>('grid')
  const [page, setPage]               = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build stable cache key from server-side filter params (excludes search — debounced separately)
  const serverFilterKey = useMemo(() => JSON.stringify({
    platforms: filters.platforms.length === 1 ? filters.platforms[0] : null,
    categories: filters.categories.length === 1 ? filters.categories[0] : null,
    country: filters.country,
    isVerified: filters.isVerified,
    isActive: filters.isActive,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  }), [filters.platforms, filters.categories, filters.country, filters.isVerified, filters.isActive, filters.sortBy, filters.sortOrder])

  const fetchInfluencers = useCallback(async (
    currentPage: number,
    currentFilters: InfluencerFilters,
    search: string
  ) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page:  String(currentPage),
        limit: String(INFLUENCERS_PAGE_SIZE),
      })
      if (search)                                     params.set('search', search)
      if (currentFilters.platforms.length === 1)      params.set('platform', currentFilters.platforms[0])
      if (currentFilters.categories.length === 1)     params.set('category', currentFilters.categories[0])
      if (currentFilters.country)                     params.set('country', currentFilters.country)
      if (currentFilters.isVerified !== null)         params.set('verified', String(currentFilters.isVerified))
      if (currentFilters.isActive === false)          params.set('is_active', 'false')
      else if (currentFilters.isActive === true)      params.set('is_active', 'true')
      if (currentFilters.sortBy !== 'created_at')     params.set('sort_by', currentFilters.sortBy)
      params.set('sort_dir', currentFilters.sortOrder)

      const res = await fetch(`${apiBase}?${params}`)
      if (!res.ok) throw new Error('Error cargando influencers')
      const json = await res.json()
      const rows = (json.data ?? []).map((inf: Record<string, unknown>) => ({
        ...inf,
        social_profiles: inf.social_profiles ?? inf.influencer_social_profiles ?? [],
        rate_cards:      inf.rate_cards      ?? inf.influencer_rate_cards      ?? [],
      }))
      setInfluencers(rows as Influencer[])
      setDbTotal(json.total ?? rows.length)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando influencers')
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce search — 350ms after last keystroke
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [filters.search])

  // Fetch when page, debounced search, or server filters change
  useEffect(() => {
    fetchInfluencers(page, filters, debouncedSearch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, serverFilterKey])

  // Re-fetch when Instagram sync completes (from DataQualityClient)
  useEffect(() => {
    const handler = () => fetchInfluencers(page, filters, debouncedSearch)
    window.addEventListener('influencers-synced', handler)
    return () => window.removeEventListener('influencers-synced', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, serverFilterKey])

  // Client-side post-filter: tier + multi-platform + engagement (requires join data)
  const filtered = useMemo(() => {
    let list = [...influencers]
    // Multi-platform (server only handles single platform)
    if (filters.platforms.length > 1) {
      list = list.filter(inf =>
        inf.social_profiles?.some(sp => filters.platforms.includes(sp.platform))
      )
    }
    // Multi-category
    if (filters.categories.length > 1) {
      list = list.filter(inf =>
        filters.categories.some(cat => (inf.categories ?? []).includes(cat))
      )
    }
    // Tier (requires follower count from social_profiles)
    if (filters.tier) {
      list = list.filter(inf => {
        const primary = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
        return primary && getInfluencerTier(primary.followers) === filters.tier
      })
    }
    // Engagement min
    if (filters.minEngagement > 0) {
      list = list.filter(inf => {
        const primary = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
        return primary && (primary.engagement_rate ?? 0) >= filters.minEngagement
      })
    }
    return list
  }, [influencers, filters.platforms, filters.categories, filters.tier, filters.minEngagement])

  const updateFilter = useCallback((partial: Partial<InfluencerFilters>) => {
    setFilters(prev => ({ ...prev, ...partial }))
    setPage(1) // always reset to page 1 on any filter change
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_INFLUENCER_FILTERS)
    setPage(1)
  }, [])

  const toggleSort = useCallback((col: InfluencerFilters['sortBy']) => {
    setFilters(prev => ({
      ...prev,
      sortBy: col,
      sortOrder: prev.sortBy === col && prev.sortOrder === 'desc' ? 'asc' : 'desc',
    }))
    setPage(1)
  }, [])

  const totalPages = Math.ceil(dbTotal / INFLUENCERS_PAGE_SIZE)

  return {
    influencers: filtered,
    total: dbTotal,
    filtered: filtered.length,
    loading,
    error,
    filters,
    view,
    setView,
    updateFilter,
    resetFilters,
    toggleSort,
    refetch: () => fetchInfluencers(page, filters, debouncedSearch),
    // Pagination
    page,
    setPage,
    totalPages,
    pageSize: INFLUENCERS_PAGE_SIZE,
  }
}
