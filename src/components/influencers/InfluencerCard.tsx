'use client'

import { Star, MapPin, CheckCircle2, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import type { Influencer } from '@/types'

interface Props {
  influencer: Influencer
  compact?: boolean
}

const AVATAR_GRADIENTS = [
  'from-pink-400 to-violet-600',
  'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-red-500',
  'from-amber-400 to-orange-500',
  'from-violet-400 to-indigo-600',
]

function getGradient(id: string) {
  const idx = id.charCodeAt(0) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[idx]
}

function buildProfileUrl(platform: string, username: string | null): string | null {
  if (!username) return null
  const u = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram': return `https://instagram.com/${u}`
    case 'tiktok':    return `https://tiktok.com/@${u}`
    case 'youtube':   return `https://youtube.com/@${u}`
    case 'twitter':   return `https://twitter.com/${u}`
    case 'facebook':  return `https://facebook.com/${u}`
    case 'linkedin':  return `https://linkedin.com/in/${u}`
    default:          return null
  }
}

export function InfluencerCard({ influencer, compact = false }: Props) {
  const primaryProfile = influencer.social_profiles?.find(s => s.is_primary)
    ?? influencer.social_profiles?.[0]

  const initials = influencer.display_name
    .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <Link
      href={`/influencers/${influencer.id}`}
      className="card block hover:shadow-card-md hover:-translate-y-0.5 transition-all duration-200 group"
    >
      {/* Cover opcional */}
      {influencer.cover_url && !compact && (
        <div
          className="h-20 rounded-t-xl bg-cover bg-center"
          style={{ backgroundImage: `url(${influencer.cover_url})` }}
        />
      )}

      <div className={cn('p-4', compact && 'p-3')}>
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          {/* Avatar */}
          <div className={cn(
            'rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 bg-gradient-to-br',
            getGradient(influencer.id),
            compact ? 'w-10 h-10 text-sm' : 'w-12 h-12 text-base',
            influencer.cover_url && !compact ? '-mt-6 ring-2 ring-white' : ''
          )}>
            {influencer.avatar_url
              ? <img src={influencer.avatar_url} alt={influencer.display_name} className="w-full h-full rounded-full object-cover" />
              : initials
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className={cn('font-semibold text-gray-900 truncate', compact ? 'text-sm' : 'text-sm')}>
                {influencer.display_name}
              </span>
              {influencer.is_verified && (
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
              )}
            </div>
            {primaryProfile && (() => {
              const pUrl = primaryProfile.profile_url || buildProfileUrl(primaryProfile.platform, primaryProfile.username ?? null)
              const label = primaryProfile.username ? `@${primaryProfile.username}` : primaryProfile.platform
              return pUrl ? (
                <a
                  href={pUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs text-violet-600 hover:underline"
                >
                  {PLATFORM_ICONS[primaryProfile.platform]}{' '}{label}
                </a>
              ) : (
                <span className="text-xs text-gray-400">
                  {PLATFORM_ICONS[primaryProfile.platform]}{' '}{label}
                </span>
              )
            })()}
            {(influencer.city || influencer.country) && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 text-gray-300" />
                <span className="text-xs text-gray-400">
                  {[influencer.city, influencer.country].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>

          {/* Rating */}
          {(influencer.rating ?? 0) > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
              <span className="text-xs font-semibold text-gray-700">{(influencer.rating ?? 0).toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Categorías */}
        {!compact && (influencer.categories ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {(influencer.categories ?? []).slice(0, 3).map(cat => (
              <span key={cat} className="badge badge-purple text-[10px]">{cat}</span>
            ))}
            {(influencer.categories ?? []).length > 3 && (
              <span className="badge badge-gray text-[10px]">+{(influencer.categories ?? []).length - 3}</span>
            )}
          </div>
        )}

        {/* Métricas */}
        <div className={cn(
          'grid gap-2',
          compact ? 'grid-cols-2' : 'grid-cols-3'
        )}>
          {primaryProfile && (
            <div className="bg-gray-50 rounded-lg p-2 text-center">
              <div className={cn('font-bold text-gray-900', compact ? 'text-sm' : 'text-base')}>
                {formatFollowers(primaryProfile.followers)}
              </div>
              <div className="text-[10px] text-gray-400 font-medium">Seguidores</div>
            </div>
          )}

          {primaryProfile && (
            <div className="bg-gray-50 rounded-lg p-2 text-center">
              <div className={cn('font-bold text-gray-900', compact ? 'text-sm' : 'text-base')}>
                {((primaryProfile.engagement_rate ?? 0)).toFixed(1)}%
              </div>
              <div className="text-[10px] text-gray-400 font-medium">Engagement</div>
            </div>
          )}

          {!compact && (
            <div className="bg-gray-50 rounded-lg p-2 text-center">
              <div className="text-base font-bold text-gray-900">
                ${influencer.rate_cards?.[0]?.base_rate
                  ? `${(influencer.rate_cards[0].base_rate / 1000).toFixed(1)}K`
                  : '—'}
              </div>
              <div className="text-[10px] text-gray-400 font-medium">Rate base</div>
            </div>
          )}
        </div>

        {/* Plataformas */}
        {!compact && (influencer.social_profiles ?? []).length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
            {(influencer.social_profiles ?? []).map(sp => (
              <span key={sp.id} className="text-base" title={sp.platform}>
                {PLATFORM_ICONS[sp.platform]}
              </span>
            ))}
            <div className="ml-auto">
              <span className={cn(
                'badge text-[10px]',
                influencer.is_active ? 'badge-green' : 'badge-gray'
              )}>
                {influencer.is_active ? 'Disponible' : 'Inactivo'}
              </span>
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
