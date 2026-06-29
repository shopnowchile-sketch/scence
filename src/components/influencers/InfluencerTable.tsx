'use client'

import { CheckCircle2, MapPin, Star, ArrowUpDown, ExternalLink, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { cn, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import type { Influencer, InfluencerFilters } from '@/types'

interface Props {
  influencers: Influencer[]
  onSort: (col: InfluencerFilters['sortBy']) => void
  sortBy: InfluencerFilters['sortBy']
  sortOrder: InfluencerFilters['sortOrder']
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: () => void
  onDelete?: (inf: Influencer) => void
}

const AVATAR_GRADIENTS = [
  'from-pink-400 to-violet-600',
  'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-red-500',
  'from-amber-400 to-orange-500',
  'from-violet-400 to-indigo-600',
]

function TH({ children, col, sortBy, sortOrder, onSort }: {
  children: React.ReactNode
  col?: InfluencerFilters['sortBy']
  sortBy: InfluencerFilters['sortBy']
  sortOrder: InfluencerFilters['sortOrder']
  onSort: (col: InfluencerFilters['sortBy']) => void
}) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50',
        col && 'cursor-pointer hover:text-gray-600 select-none'
      )}
      onClick={() => col && onSort(col)}
    >
      <div className="flex items-center gap-1">
        {children}
        {col && (
          <ArrowUpDown className={cn(
            'h-3 w-3 flex-shrink-0',
            sortBy === col ? 'text-violet-500' : 'text-gray-300'
          )} />
        )}
      </div>
    </th>
  )
}

export function InfluencerTable({
  influencers, onSort, sortBy, sortOrder,
  selectable = false, selectedIds, onToggleSelect, onToggleAll, onDelete,
}: Props) {
  const allSelected = selectable && influencers.length > 0 && influencers.every(i => selectedIds?.has(i.id))

  if (influencers.length === 0) {
    return (
      <div className="card">
        <div className="py-16 text-center">
          <p className="text-gray-400 text-sm">No se encontraron influencers con esos filtros.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {selectable && (
                <th className="px-4 py-3 bg-gray-50 w-10">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                    className="rounded border-gray-300 text-violet-600" />
                </th>
              )}
              <TH col="display_name" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort}>Influencer</TH>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Plataformas</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Categorías</th>
              <TH col="followers" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort}>Seguidores</TH>
              <TH col="engagement_rate" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort}>Engagement</TH>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Rate base</th>
              <TH col="rating" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort}>Rating</TH>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Estado</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">Última conexión</th>
              <th className="px-4 py-3 bg-gray-50" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {influencers.map((inf, i) => {
              const primaryProfile = inf.social_profiles?.find(s => s.is_primary) ?? inf.social_profiles?.[0]
              const gradient = AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]
              const initials = inf.display_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

              return (
                <tr key={inf.id} className={cn(
                  'hover:bg-gray-50/70 transition-colors group',
                  selectedIds?.has(inf.id) && 'bg-violet-50/50'
                )}>
                  {selectable && (
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds?.has(inf.id) ?? false}
                        onChange={() => onToggleSelect?.(inf.id)}
                        className="rounded border-gray-300 text-violet-600" />
                    </td>
                  )}
                  {/* Influencer */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 bg-gradient-to-br',
                        gradient
                      )}>
                        {inf.avatar_url
                          ? <img src={inf.avatar_url} alt={inf.display_name} className="w-full h-full rounded-full object-cover" />
                          : initials
                        }
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/influencers/${inf.id}`}
                            className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors"
                          >
                            {inf.display_name}
                          </Link>
                          {inf.is_verified && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          {primaryProfile && <span>@{primaryProfile.username}</span>}
                          {(inf.city || inf.country) && (
                            <>
                              <span>·</span>
                              <MapPin className="h-3 w-3" />
                              <span>{[inf.city, inf.country].filter(Boolean).join(', ')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Plataformas */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {inf.social_profiles?.slice(0, 4).map(sp => (
                        <span key={sp.id} className="text-base" title={sp.platform}>
                          {PLATFORM_ICONS[sp.platform]}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Categorías */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(inf.categories ?? []).slice(0, 2).map(cat => (
                        <span key={cat} className="badge badge-purple text-[10px]">{cat}</span>
                      ))}
                      {(inf.categories ?? []).length > 2 && (
                        <span className="badge badge-gray text-[10px]">+{(inf.categories ?? []).length - 2}</span>
                      )}
                    </div>
                  </td>

                  {/* Seguidores */}
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-gray-900">
                      {primaryProfile ? formatFollowers(primaryProfile.followers) : '—'}
                    </div>
                    {primaryProfile && (
                      <div className="text-xs text-gray-400 capitalize">{primaryProfile.platform}</div>
                    )}
                  </td>

                  {/* Engagement */}
                  <td className="px-4 py-3">
                    {primaryProfile ? (
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500"
                            style={{ width: `${Math.min((primaryProfile.engagement_rate ?? 0) * 10, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-gray-900">
                          {(primaryProfile.engagement_rate ?? 0).toFixed(1)}%
                        </span>
                      </div>
                    ) : '—'}
                  </td>

                  {/* Rate base */}
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {inf.rate_cards?.[0]
                      ? `$${inf.rate_cards[0].base_rate.toLocaleString()} ${inf.rate_cards[0].currency}`
                      : <span className="text-gray-400">—</span>
                    }
                  </td>

                  {/* Rating */}
                  <td className="px-4 py-3">
                    {(inf.rating ?? 0) > 0 ? (
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                        <span className="text-sm font-semibold text-gray-900">{(inf.rating ?? 0).toFixed(1)}</span>
                      </div>
                    ) : <span className="text-gray-400 text-sm">—</span>}
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3">
                    <span className={cn('badge text-[11px]',
                      (inf.metadata as Record<string,unknown>|null)?.status === 'draft' ? 'badge-gray' :
                      inf.is_active ? 'badge-green' : 'badge-red'
                    )}>
                      {(inf.metadata as Record<string,unknown>|null)?.status === 'draft' ? 'Draft' :
                       inf.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>

                  {/* Última conexión */}
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {inf.last_sign_in_at
                      ? new Date(inf.last_sign_in_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : <span className="text-gray-300">Sin acceso</span>}
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <Link
                        href={`/influencers/${inf.id}`}
                        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Ver perfil"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      {onDelete && (
                        <button
                          onClick={() => onDelete(inf)}
                          className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                          title="Eliminar permanentemente"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
