'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Trophy, TrendingUp, Star, Users, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import { cn, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import type { Influencer } from '@/types'

type RankCriteria = 'score' | 'followers' | 'engagement' | 'rating'

const MEDAL: Record<number, { emoji: string; color: string }> = {
  1: { emoji: '🥇', color: 'text-amber-500' },
  2: { emoji: '🥈', color: 'text-gray-400' },
  3: { emoji: '🥉', color: 'text-orange-400' },
}

function scoreInfluencer(inf: Influencer): number {
  const primary = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
  const followers = primary?.followers ?? 0
  const engagement = primary?.engagement_rate ?? 0
  const rating = inf.rating ?? 0

  // Normalized composite: 50% followers (log scale), 30% engagement, 20% rating
  const followersScore = followers > 0 ? Math.log10(followers) / Math.log10(10_000_000) : 0
  const engagementScore = Math.min(engagement / 10, 1)
  const ratingScore = rating / 5

  return Math.round((followersScore * 50 + engagementScore * 30 + ratingScore * 20) * 10) / 10
}

interface Props {
  influencers: Influencer[]
  loading?: boolean
}

export function InfluencerRanking({ influencers, loading }: Props) {
  const [criteria, setCriteria] = useState<RankCriteria>('score')

  const ranked = useMemo(() => {
    return [...influencers]
      .map(inf => {
        const primary = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
        return {
          inf,
          primary,
          score: scoreInfluencer(inf),
          followers: primary?.followers ?? 0,
          engagement: primary?.engagement_rate ?? 0,
          rating: inf.rating ?? 0,
        }
      })
      .sort((a, b) => {
        if (criteria === 'score')      return b.score - a.score
        if (criteria === 'followers')  return b.followers - a.followers
        if (criteria === 'engagement') return b.engagement - a.engagement
        if (criteria === 'rating')     return b.rating - a.rating
        return 0
      })
  }, [influencers, criteria])

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  const CRITERIA_OPTIONS: { value: RankCriteria; label: string; icon: React.ReactNode }[] = [
    { value: 'score',      label: 'Score compuesto',  icon: <Trophy className="h-3.5 w-3.5" /> },
    { value: 'followers',  label: 'Seguidores',       icon: <Users className="h-3.5 w-3.5" /> },
    { value: 'engagement', label: 'Engagement',       icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { value: 'rating',     label: 'Rating',           icon: <Star className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-4">
      {/* Criteria selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400 mr-1">Ordenar por:</span>
        {CRITERIA_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setCriteria(opt.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
              criteria === opt.value
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* Podium — top 3 */}
      {ranked.length >= 3 && (
        <div className="grid grid-cols-3 gap-3 mb-2">
          {[ranked[1], ranked[0], ranked[2]].map((item, podiumIdx) => {
            const rank = podiumIdx === 1 ? 1 : podiumIdx === 0 ? 2 : 3
            const medal = MEDAL[rank]
            const heights = ['h-28', 'h-36', 'h-24']
            return (
              <Link
                key={item.inf.id}
                href={`/admin-influencers/${item.inf.id}`}
                className={cn(
                  'flex flex-col items-center justify-end gap-1 rounded-2xl border p-3 transition-all hover:shadow-md cursor-pointer',
                  rank === 1
                    ? 'bg-amber-50 border-amber-200'
                    : rank === 2 ? 'bg-gray-50 border-gray-200' : 'bg-orange-50 border-orange-200'
                )}
              >
                <div className={cn('flex flex-col items-center justify-end flex-1', heights[podiumIdx])}>
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-pink-500 flex items-center justify-center text-white font-bold text-lg mb-1">
                    {item.inf.display_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="text-[10px] font-bold text-gray-700 text-center leading-tight truncate w-full text-center px-1">
                    {item.inf.display_name}
                  </span>
                  <span className="text-lg mt-0.5">{medal.emoji}</span>
                  {item.primary && (
                    <span className="text-[10px] text-gray-400 mt-0.5">
                      {PLATFORM_ICONS[item.primary.platform]} {formatFollowers(item.followers)}
                    </span>
                  )}
                  <span className={cn('text-xs font-black mt-1', medal.color)}>
                    {criteria === 'score' ? `${item.score}pts`
                      : criteria === 'followers' ? formatFollowers(item.followers)
                      : criteria === 'engagement' ? `${item.engagement.toFixed(1)}%`
                      : `${item.rating.toFixed(1)}★`}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Full leaderboard */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-400 px-4 py-3 w-12">#</th>
              <th className="text-left text-xs font-semibold text-gray-400 px-4 py-3">Influencer</th>
              <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Seguidores</th>
              <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Engagement</th>
              <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Rating</th>
              <th className="text-right text-xs font-semibold text-gray-400 px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((item, idx) => {
              const rank = idx + 1
              const medal = MEDAL[rank]
              return (
                <tr
                  key={item.inf.id}
                  className={cn(
                    'border-b border-gray-50 hover:bg-violet-50/40 transition-colors',
                    rank <= 3 && 'bg-gradient-to-r from-amber-50/30 to-transparent'
                  )}
                >
                  {/* Rank */}
                  <td className="px-4 py-3">
                    {medal ? (
                      <span className="text-lg">{medal.emoji}</span>
                    ) : (
                      <span className="text-sm font-bold text-gray-300">#{rank}</span>
                    )}
                  </td>

                  {/* Influencer */}
                  <td className="px-4 py-3">
                    <Link href={`/admin-influencers/${item.inf.id}`} className="flex items-center gap-3 hover:underline">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {item.inf.display_name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{item.inf.display_name}</div>
                        {item.primary && (
                          <div className="text-xs text-gray-400">
                            {PLATFORM_ICONS[item.primary.platform]} @{item.primary.username ?? '—'}
                          </div>
                        )}
                      </div>
                    </Link>
                  </td>

                  {/* Followers */}
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-sm font-semibold',
                      criteria === 'followers' ? 'text-violet-600' : 'text-gray-700'
                    )}>
                      {item.followers > 0 ? formatFollowers(item.followers) : '—'}
                    </span>
                  </td>

                  {/* Engagement */}
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-sm font-semibold',
                      criteria === 'engagement' ? 'text-violet-600' : 'text-gray-700'
                    )}>
                      {item.engagement > 0 ? `${item.engagement.toFixed(1)}%` : '—'}
                    </span>
                  </td>

                  {/* Rating */}
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'text-sm font-semibold',
                      criteria === 'rating' ? 'text-violet-600' : 'text-gray-700'
                    )}>
                      {item.rating > 0 ? `${item.rating.toFixed(1)} ★` : '—'}
                    </span>
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold',
                      criteria === 'score'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 text-gray-600'
                    )}>
                      {item.score}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ranked.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No hay influencers para mostrar en el ranking
          </div>
        )}
      </div>
    </div>
  )
}
