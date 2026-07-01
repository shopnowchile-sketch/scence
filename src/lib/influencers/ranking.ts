export type RankingSortBy =
  | 'followers'
  | 'engagement'
  | 'rating'
  | 'campaigns'
  | 'deliverables_completed'
  | 'completion_rate'
  | 'display_name'
  | 'city'
  | 'last_connection'

export type RankingSocialProfile = {
  platform?: string | null
  username?: string | null
  followers?: number | null
  engagement_rate?: number | null
  is_primary?: boolean | null
}

export type RankingInfluencerRow = {
  id: string
  display_name?: string | null
  email?: string | null
  user_id?: string | null
  last_sign_in_at?: string | null
  city?: string | null
  commune?: string | null
  country?: string | null
  categories?: string[] | null
  rating?: number | null
  social_profiles?: RankingSocialProfile[]
  influencer_social_profiles?: RankingSocialProfile[]
  campaign_count: number
  deliverables_total: number
  deliverables_completed: number
  completion_rate: number
}

type CampaignInfluencerRow = {
  id?: string | null
  influencer_id?: string | null
  status?: string | null
}

type DeliverableRow = {
  influencer_id?: string | null
  campaign_influencer_id?: string | null
  status?: string | null
}

export function getPrimarySocial(inf: RankingInfluencerRow) {
  const socials = inf.social_profiles ?? inf.influencer_social_profiles ?? []
  return socials.find(s => s.is_primary) ?? socials[0] ?? null
}

export function getRankingValue(inf: RankingInfluencerRow, sortBy: RankingSortBy) {
  const primary = getPrimarySocial(inf)

  if (sortBy === 'followers') return Number(primary?.followers ?? 0)
  if (sortBy === 'engagement') return Number(primary?.engagement_rate ?? 0)
  if (sortBy === 'rating') return Number(inf.rating ?? 0)
  if (sortBy === 'campaigns') return Number(inf.campaign_count ?? 0)
  if (sortBy === 'deliverables_completed') return Number(inf.deliverables_completed ?? 0)
  if (sortBy === 'completion_rate') return Number(inf.completion_rate ?? 0)
  if (sortBy === 'last_connection') return inf.last_sign_in_at ? new Date(inf.last_sign_in_at).getTime() : 0

  return 0
}

export function buildRankingRows(
  influencers: Array<Record<string, unknown>>,
  campaignInfluencers: CampaignInfluencerRow[],
  deliverables: DeliverableRow[]
): RankingInfluencerRow[] {
  const ciById = new Map<string, CampaignInfluencerRow>()
  const campaignsByInfluencer = new Map<string, Set<string>>()
  const deliverablesByInfluencer = new Map<string, { total: number; completed: number }>()

  for (const ci of campaignInfluencers) {
    if (!ci.id || !ci.influencer_id) continue

    ciById.set(ci.id, ci)

    if (!campaignsByInfluencer.has(ci.influencer_id)) {
      campaignsByInfluencer.set(ci.influencer_id, new Set())
    }

    campaignsByInfluencer.get(ci.influencer_id)?.add(ci.id)
  }

  for (const d of deliverables) {
    const influencerId =
      d.influencer_id ??
      (d.campaign_influencer_id ? ciById.get(d.campaign_influencer_id)?.influencer_id : null)

    if (!influencerId) continue

    const current = deliverablesByInfluencer.get(influencerId) ?? { total: 0, completed: 0 }
    current.total += 1

    if (['published', 'approved', 'completed'].includes(String(d.status ?? ''))) {
      current.completed += 1
    }

    deliverablesByInfluencer.set(influencerId, current)
  }

  return influencers.map(raw => {
    const id = String(raw.id)
    const deliverableStats = deliverablesByInfluencer.get(id) ?? { total: 0, completed: 0 }
    const total = deliverableStats.total
    const completed = deliverableStats.completed

    return {
      ...(raw as RankingInfluencerRow),
      social_profiles: (raw.social_profiles ?? raw.influencer_social_profiles ?? []) as RankingSocialProfile[],
      campaign_count: campaignsByInfluencer.get(id)?.size ?? 0,
      deliverables_total: total,
      deliverables_completed: completed,
      completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    }
  })
}

export function sortRankingRows(
  rows: RankingInfluencerRow[],
  sortBy: RankingSortBy,
  sortDir: 'asc' | 'desc'
) {
  return [...rows].sort((a, b) => {
    if (sortBy === 'display_name') {
      const av = a.display_name ?? ''
      const bv = b.display_name ?? ''
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }

    if (sortBy === 'city') {
      const av = a.commune ?? a.city ?? ''
      const bv = b.commune ?? b.city ?? ''
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }

    const av = getRankingValue(a, sortBy)
    const bv = getRankingValue(b, sortBy)

    return sortDir === 'asc' ? av - bv : bv - av
  })
}
