'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  MapPin,
  Star,
} from 'lucide-react'
import { formatFollowers, PLATFORM_LABELS } from '@/lib/utils'

type SocialProfile = {
  platform: string
  username: string | null
  followers: number | null
  engagement_rate: number | null
  is_primary: boolean | null
}

type RateCard = {
  deliverable_type: string
  base_rate: number | null
  currency: string | null
}

type Influencer = {
  id: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  categories: string[] | null
  country: string | null
  city: string | null
  rating?: number | null
  influencer_social_profiles?: SocialProfile[]
  influencer_rate_cards?: RateCard[]
}

function profileUrl(platform: string, username: string | null) {
  if (!username) return null
  const value = username.replace(/^@/, '')
  if (platform === 'instagram') return `https://instagram.com/${value}`
  if (platform === 'tiktok') return `https://tiktok.com/@${value}`
  if (platform === 'youtube') return `https://youtube.com/@${value}`
  return null
}

export default function BrandInfluencerProfilePage({
  params,
}: {
  params: { id: string }
}) {
  const [data, setData] = useState<Influencer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    fetch(`/api/brand/influencers/${params.id}`)
      .then(async response => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error ?? 'No se pudo cargar el perfil')
        if (!cancelled) setData(json.data)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params.id])

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-red-500">{error || 'Influencer no encontrada'}</p>
        <Link href="/brand-influencers" className="inline-block mt-4 text-sm text-violet-600 hover:underline">
          Volver a influencers
        </Link>
      </div>
    )
  }

  const socials = data.influencer_social_profiles ?? []
  const rates = data.influencer_rate_cards ?? []

  return (
    <div className="space-y-5">
      <Link
        href="/brand-influencers"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Influencers
      </Link>

      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          {data.avatar_url ? (
            <img
              src={data.avatar_url}
              alt={data.display_name}
              className="h-24 w-24 rounded-2xl object-cover"
            />
          ) : (
            <div className="h-24 w-24 rounded-2xl bg-violet-100 flex items-center justify-center text-3xl font-bold text-violet-600">
              {data.display_name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{data.display_name}</h1>

            {(data.city || data.country) && (
              <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                <MapPin className="h-4 w-4" />
                {[data.city, data.country].filter(Boolean).join(', ')}
              </p>
            )}

            {typeof data.rating === 'number' && (
              <p className="flex items-center gap-1 text-sm text-amber-600 mt-2">
                <Star className="h-4 w-4 fill-current" />
                {data.rating.toFixed(1)}
              </p>
            )}

            {data.bio && (
              <p className="text-sm text-gray-600 leading-relaxed mt-4">{data.bio}</p>
            )}

            {!!data.categories?.length && (
              <div className="flex flex-wrap gap-2 mt-4">
                {data.categories.map(category => (
                  <span key={category} className="badge badge-gray">{category}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="font-bold text-gray-900 mb-4">Redes sociales</h2>

          {socials.length === 0 ? (
            <p className="text-sm text-gray-400">Sin redes registradas.</p>
          ) : (
            <div className="space-y-3">
              {socials.map((social, index) => {
                const url = profileUrl(social.platform, social.username)

                return (
                  <div key={`${social.platform}-${index}`} className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {PLATFORM_LABELS[social.platform] ?? social.platform}
                      </p>
                      <p className="text-xs text-gray-500">
                        {social.username ? `@${social.username.replace(/^@/, '')}` : 'Sin usuario'}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">
                        {formatFollowers(social.followers ?? 0)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {Number(social.engagement_rate ?? 0).toFixed(1)}% engagement
                      </p>
                    </div>

                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-600 hover:text-violet-700"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-bold text-gray-900 mb-4">Tarifas</h2>

          {rates.length === 0 ? (
            <p className="text-sm text-gray-400">Sin tarifas registradas.</p>
          ) : (
            <div className="space-y-3">
              {rates.map((rate, index) => (
                <div key={`${rate.deliverable_type}-${index}`} className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                  <span className="text-sm font-medium text-gray-700">{rate.deliverable_type}</span>
                  <span className="text-sm font-bold text-gray-900">
                    {(rate.currency ?? 'CLP')} {(rate.base_rate ?? 0).toLocaleString('es-CL')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
