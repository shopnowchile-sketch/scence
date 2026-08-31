'use client'

import { useState } from 'react'
import { CheckCircle2, MapPin, Star, ExternalLink, Trash2, Columns3, Send } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn, formatFollowers, PLATFORM_ICONS } from '@/lib/utils'
import type { Influencer, InfluencerFilters } from '@/types'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import { useColumnWidths } from '@/hooks/useColumnWidths'
import { SortableTH } from '@/components/ui/SortableTH'

type ColKey = 'display_name' | 'platforms' | 'categories' | 'followers' | 'engagement' | 'rate' | 'rating' | 'status' | 'commune' | 'birthDate' | 'lastConnection' | 'registeredBy' | 'associatedBrands'

const DEFAULT_WIDTHS: Record<ColKey, number> = {
  display_name: 280, platforms: 120, categories: 160, followers: 130,
  engagement: 140, rate: 120, rating: 90, status: 100, commune: 130, birthDate: 100, lastConnection: 170,
  registeredBy: 140, associatedBrands: 220,
}

function calculateAge(birthDate: string): number | null {
  const [year, month, day] = birthDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null

  const today = new Date()
  let age = today.getFullYear() - year
  const hasNotHadBirthday =
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)

  if (hasNotHadBirthday) age -= 1
  return age >= 0 && age <= 120 ? age : null
}

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
  renderAction?: (inf: Influencer) => React.ReactNode
  /** admin: link a /admin-influencers/[id]. brand: sin perfil propio aun (gap G-09) -> no clickable. */
  portal?: 'admin' | 'brand'
}

const AVATAR_GRADIENTS = [
  'from-pink-400 to-violet-600',
  'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-red-500',
  'from-amber-400 to-orange-500',
  'from-violet-400 to-indigo-600',
]

// TH sortable — reemplazado por el componente compartido SortableTH
// (mismo patrón que usa InfluencerRanking.tsx). sortOrder -> sortDir.
function TH({ children, col, sortBy, sortOrder, onSort, onResizeStart }: {
  children: React.ReactNode
  col?: InfluencerFilters['sortBy']
  sortBy: InfluencerFilters['sortBy']
  sortOrder: InfluencerFilters['sortOrder']
  onSort: (col: InfluencerFilters['sortBy']) => void
  onResizeStart?: (e: React.MouseEvent) => void
}) {
  return (
    <SortableTH col={col} sortBy={sortBy} sortDir={sortOrder} onSort={onSort} onResizeStart={onResizeStart}>
      {children}
    </SortableTH>
  )
}

export function InfluencerTable({
  influencers, onSort, sortBy, sortOrder,
  selectable = false, selectedIds, onToggleSelect, onToggleAll, onDelete, renderAction,
  portal = 'admin',
}: Props) {
  const allSelected = selectable && influencers.length > 0 && influencers.every(i => selectedIds?.has(i.id))
  const [showColumns, setShowColumns] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)

  async function handleInvite(inf: Influencer) {
    setInvitingId(inf.id)
    try {
      const res = await fetch(`/api/influencers/${inf.id}/invite`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al invitar')
      toast.success(json.message ?? 'Invitación enviada')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al invitar')
    }
    setInvitingId(null)
  }
  const [visible, setVisible] = useLocalStorageState('scence:admin:influencer-table:columns', {
    platforms: true,
    categories: true,
    followers: true,
    engagement: true,
    rate: true,
    rating: true,
    status: true,
    commune: true,
    birthDate: true,
    lastConnection: true,
    registeredBy: true,
    associatedBrands: true,
  })
  // Ancho de columnas ajustable por drag — regla global (ver useColumnWidths).
  const { widths, startResize } = useColumnWidths<ColKey>('scence:admin:influencer-table:widths', DEFAULT_WIDTHS)

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <p className="text-sm font-semibold text-gray-700">Lista de influencers</p>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColumns(prev => !prev)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Columns3 className="h-4 w-4" />
            Columnas
          </button>

          {showColumns && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-lg p-2 z-20">
              {([
                ['platforms', 'Plataformas'],
                ['categories', 'Categorías'],
                ['followers', 'Seguidores'],
                ['engagement', 'Engagement'],
                ['rate', 'Rate base'],
                ['rating', 'Rating'],
                ['status', 'Estado'],
                ['commune', 'Comuna'],
                ['birthDate', 'Edad'],
                ...(portal === 'admin' ? ([
                  ['lastConnection', 'Última conexión'],
                  ['registeredBy', 'Registrada por'],
                  ['associatedBrands', 'Marcas asignadas'],
                ] as const) : []),
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={visible[key]}
                    onChange={() => setVisible(prev => ({ ...prev, [key]: !prev[key] }))}
                    className="rounded border-gray-300 text-violet-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {selectable && <col style={{ width: 40 }} />}
            <col style={{ width: widths.display_name }} />
            {visible.platforms      && <col style={{ width: widths.platforms }} />}
            {visible.categories     && <col style={{ width: widths.categories }} />}
            {visible.followers      && <col style={{ width: widths.followers }} />}
            {visible.engagement     && <col style={{ width: widths.engagement }} />}
            {visible.rate           && <col style={{ width: widths.rate }} />}
            {visible.rating         && <col style={{ width: widths.rating }} />}
            {visible.status         && <col style={{ width: widths.status }} />}
            {visible.commune        && <col style={{ width: widths.commune }} />}
            {visible.birthDate      && <col style={{ width: widths.birthDate }} />}
            {portal === 'admin' && visible.lastConnection && <col style={{ width: widths.lastConnection }} />}
            {portal === 'admin' && visible.registeredBy      && <col style={{ width: widths.registeredBy }} />}
            {portal === 'admin' && visible.associatedBrands  && <col style={{ width: widths.associatedBrands }} />}
            <col style={{ width: renderAction ? 220 : 90 }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-100">
              {selectable && (
                <th className="px-4 py-3 bg-gray-50 w-10">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                    className="rounded border-gray-300 text-violet-600" />
                </th>
              )}
              <TH col="display_name" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('display_name', e)}>Influencer</TH>
              {visible.platforms && (
                <SortableTH<ColKey> onResizeStart={e => startResize('platforms', e)}>Plataformas</SortableTH>
              )}
              {visible.categories && (
                <SortableTH<ColKey> onResizeStart={e => startResize('categories', e)}>Categorías</SortableTH>
              )}
              {visible.followers && <TH col="followers" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('followers', e)}>Seguidores</TH>}
              {visible.engagement && <TH col="engagement_rate" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('engagement', e)}>Engagement</TH>}
              {visible.rate && (
                <SortableTH<ColKey> onResizeStart={e => startResize('rate', e)}>Rate base</SortableTH>
              )}
              {visible.rating && <TH col="rating" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('rating', e)}>Rating</TH>}
              {visible.status && <TH col="is_active" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('status', e)}>Estado</TH>}
              {visible.commune && <TH col="commune" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('commune', e)}>Comuna</TH>}
              {visible.birthDate && <TH col="birth_date" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('birthDate', e)}>Edad</TH>}
              {portal === 'admin' && visible.lastConnection && (
                <TH col="last_sign_in_at" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} onResizeStart={e => startResize('lastConnection', e)}>Última conexión</TH>
              )}
              {portal === 'admin' && visible.registeredBy && (
                <SortableTH<ColKey> onResizeStart={e => startResize('registeredBy', e)}>Registrada por</SortableTH>
              )}
              {portal === 'admin' && visible.associatedBrands && (
                <SortableTH<ColKey> onResizeStart={e => startResize('associatedBrands', e)}>Marcas asignadas</SortableTH>
              )}
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
                          {portal === 'admin' ? (
                            <Link
                              href={`/admin-influencers/${inf.id}`}
                              className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors"
                            >
                              {inf.display_name}
                            </Link>
                          ) : (
                            <Link
                              href={`/brand-influencers/${inf.id}`}
                              className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors"
                            >
                              {inf.display_name}
                            </Link>
                          )}
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold', inf.pro_source === 'manual' ? 'bg-amber-100 text-amber-800' : inf.is_pro ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500')}>
                            {inf.is_pro ? 'PLAN PRO' : 'PLAN GRATIS'}
                          </span>
                          {inf.is_verified && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          )}
                        </div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                          {primaryProfile?.username && (
                            <a
                              href={primaryProfile.profile_url || `https://www.instagram.com/${primaryProfile.username.replace(/^@/, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={event => event.stopPropagation()}
                              className="inline-flex shrink-0 items-center gap-1 font-medium text-violet-600 hover:text-violet-800 hover:underline"
                              title={`Abrir @${primaryProfile.username.replace(/^@/, '')} en Instagram`}
                            >
                              @{primaryProfile.username.replace(/^@/, '')}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          )}
                          {(inf.commune || inf.city || inf.country) && (
                            <span className="flex min-w-0 items-center gap-1 truncate text-gray-400" title={[inf.commune ?? inf.city, inf.country].filter(Boolean).join(', ')}>
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{[inf.commune ?? inf.city, inf.country].filter(Boolean).join(', ')}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Plataformas */}
                  {visible.platforms && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {inf.social_profiles?.slice(0, 4).map(sp => (
                          <span key={sp.id} className="text-base" title={sp.platform}>
                            {PLATFORM_ICONS[sp.platform]}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}

                  {/* Categorías */}
                  {visible.categories && (
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
                  )}

                  {/* Seguidores */}
                  {visible.followers && (
                    <td className="px-4 py-3">
                    <div className="text-sm font-semibold text-gray-900">
                      {primaryProfile ? formatFollowers(primaryProfile.followers) : '—'}
                    </div>
                    {primaryProfile && (
                      <div className="text-xs text-gray-400 capitalize">{primaryProfile.platform}</div>
                    )}
                    </td>
                  )}

                  {/* Engagement */}
                  {visible.engagement && (
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
                  )}

                  {/* Rate base */}
                  {visible.rate && (
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {inf.rate_cards?.[0]
                      ? `$${inf.rate_cards[0].base_rate.toLocaleString()} ${inf.rate_cards[0].currency}`
                      : <span className="text-gray-400">—</span>
                    }
                    </td>
                  )}

                  {/* Rating */}
                  {visible.rating && (
                    <td className="px-4 py-3">
                    {(inf.rating ?? 0) > 0 ? (
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                        <span className="text-sm font-semibold text-gray-900">{(inf.rating ?? 0).toFixed(1)}</span>
                      </div>
                    ) : <span className="text-gray-400 text-sm">—</span>}
                    </td>
                  )}

                  {/* Estado */}
                  {visible.status && (
                    <td className="px-4 py-3">
                    <span className={cn('badge text-[11px]',
                      (inf.metadata as Record<string,unknown>|null)?.status === 'draft' ? 'badge-gray' :
                      inf.is_active ? 'badge-green' : 'badge-red'
                    )}>
                      {(inf.metadata as Record<string,unknown>|null)?.status === 'draft' ? 'Draft' :
                       inf.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                    </td>
                  )}

                  {/* Comuna */}
                  {visible.commune && (
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {inf.commune ?? inf.city ?? '—'}
                    </td>
                  )}

                  {/* Edad */}
                  {visible.birthDate && (
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {inf.birth_date
                        ? (() => {
                            const age = calculateAge(inf.birth_date)
                            return age === null ? '—' : `${age} años`
                          })()
                        : '—'}
                    </td>
                  )}

                  {/* Última conexión */}
                  {portal === 'admin' && visible.lastConnection && (
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {inf.last_sign_in_at
                      ? new Date(inf.last_sign_in_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : <span className="text-gray-300">Nunca</span>}
                    </td>
                  )}

                  {/* Registrada por */}
                  {portal === 'admin' && visible.registeredBy && (
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap truncate">
                      {inf.registered_by === 'SCENCE' ? (
                        <span className="badge badge-purple text-[10px] font-bold">SCENCE</span>
                      ) : (
                        <span className="text-gray-700">{inf.registered_by ?? '—'}</span>
                      )}
                    </td>
                  )}

                  {/* Marcas asignadas */}
                  {portal === 'admin' && visible.associatedBrands && (
                    <td className="px-4 py-3 overflow-hidden">
                      {(inf.associated_brands?.length ?? 0) === 0 ? (
                        <span className="badge badge-gray text-[10px]">Roster SCENCE</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {inf.associated_brands!.map(b => (
                            <span key={b.id} className="badge badge-blue text-[10px]">{b.name}</span>
                          ))}
                        </div>
                      )}
                    </td>
                  )}

                  {/* Acciones */}
                  <td className="px-4 py-3">
                    {renderAction ? renderAction(inf) : <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      {portal === 'admin' && !inf.last_sign_in_at && inf.email && (
                        <button
                          onClick={() => handleInvite(inf)}
                          disabled={invitingId === inf.id}
                          className="p-1.5 rounded-md hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-colors disabled:opacity-50"
                          title={inf.user_id ? 'Reenviar invitación al portal' : 'Invitar al portal de influencer'}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(portal === 'admin' || portal === 'brand') && (
                        <Link
                          href={portal === 'admin'
                            ? `/admin-influencers/${inf.id}`
                            : `/brand-influencers/${inf.id}`}
                          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Ver perfil"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(inf)}
                          className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                          title="Eliminar permanentemente"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>}
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
