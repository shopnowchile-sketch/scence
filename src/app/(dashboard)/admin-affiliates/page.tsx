'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Link2, Plus, Copy, Trash2, ExternalLink, TrendingUp,
  MousePointerClick, ShoppingCart, DollarSign, X, ChevronRight,
  AlertCircle, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AffiliateLink {
  id: string
  organization_id: string
  influencer_id: string
  campaign_id: string | null
  name: string | null
  code: string
  redirect_url: string
  full_link: string
  clicks: number
  conversions: number
  revenue: number
  created_at: string
  influencer?: { id: string; display_name: string } | null
  campaign?: { id: string; name: string } | null
}

interface Influencer {
  id: string
  display_name: string
}

interface Campaign {
  id: string
  name: string
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function KPICards({ links }: { links: AffiliateLink[] }) {
  const totalLinks       = links.length
  const totalClicks      = links.reduce((s, l) => s + (l.clicks ?? 0), 0)
  const totalConversions = links.reduce((s, l) => s + (l.conversions ?? 0), 0)
  const totalRevenue     = links.reduce((s, l) => s + (l.revenue ?? 0), 0)

  const cards = [
    { icon: Link2,             color: 'violet',  label: 'Links activos',      value: totalLinks },
    { icon: MousePointerClick, color: 'blue',    label: 'Clicks totales',     value: totalClicks.toLocaleString('es-CL') },
    { icon: ShoppingCart,      color: 'emerald', label: 'Conversiones',       value: totalConversions.toLocaleString('es-CL') },
    { icon: DollarSign,        color: 'amber',   label: 'Revenue generado',   value: formatCurrency(totalRevenue, 'CLP') },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map(({ icon: Icon, color, label, value }) => (
        <div key={label} className="card p-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
              <Icon className={`h-4 w-4 text-${color}-600`} />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-400">{label}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── New Link Modal ────────────────────────────────────────────────────────────
interface NewLinkModalProps {
  onClose: () => void
  onCreated: (link: AffiliateLink) => void
}

function NewLinkModal({ onClose, onCreated }: NewLinkModalProps) {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [campaigns, setCampaigns]     = useState<Campaign[]>([])
  const [loading, setLoading]         = useState(true)
  const [submitting, setSubmitting]   = useState(false)

  const [influencerId, setInfluencerId] = useState('')
  const [campaignId, setCampaignId]     = useState('')
  const [redirectUrl, setRedirectUrl]   = useState('')
  const [name, setName]                 = useState('')
  const [commissionRate, setCommissionRate] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/influencers?limit=500').then(r => r.json()),
      fetch('/api/campaigns?limit=200').then(r => r.json()),
    ]).then(([infRes, campRes]) => {
      setInfluencers(infRes.data ?? [])
      setCampaigns(campRes.data ?? [])
    }).finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!influencerId || !redirectUrl) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencer_id: influencerId,
          campaign_id: campaignId || undefined,
          redirect_url: redirectUrl,
          name: name || undefined,
          commission_rate: commissionRate ? commissionRate : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al crear link')
      onCreated(json.data)
      toast.success('Link creado exitosamente')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear link')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
              <Link2 className="h-4 w-4 text-violet-600" />
            </div>
            <h2 className="text-base font-bold text-gray-900">Nuevo link de afiliado</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-violet-500 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Influencer */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Influencer <span className="text-red-500">*</span>
              </label>
              <select
                value={influencerId}
                onChange={e => setInfluencerId(e.target.value)}
                required
                className="input-base w-full"
              >
                <option value="">Seleccionar influencer...</option>
                {influencers.map(inf => (
                  <option key={inf.id} value={inf.id}>{inf.display_name}</option>
                ))}
              </select>
            </div>

            {/* Campaign (optional) */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Campaña <span className="text-gray-400">(opcional)</span>
              </label>
              <select
                value={campaignId}
                onChange={e => setCampaignId(e.target.value)}
                className="input-base w-full"
              >
                <option value="">Sin campaña</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Name (optional) */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Nombre <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Verano 2025 — Instagram"
                className="input-base w-full"
              />
            </div>

            {/* Commission rate */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Comisión % <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={commissionRate}
                onChange={e => setCommissionRate(e.target.value)}
                placeholder="Ej. 10"
                className="input-base w-full"
              />
            </div>

            {/* Redirect URL */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                URL de destino <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={redirectUrl}
                onChange={e => setRedirectUrl(e.target.value)}
                placeholder="https://tutienda.com/producto"
                required
                className="input-base w-full"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || !influencerId || !redirectUrl}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Crear link
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Stats Detail Panel ────────────────────────────────────────────────────────
interface StatsPanelProps {
  link: AffiliateLink
  onClose: () => void
}

function StatsPanel({ link, onClose }: StatsPanelProps) {
  const ctr = link.clicks > 0 ? ((link.conversions / link.clicks) * 100).toFixed(1) : '0.0'

  function copyLink() {
    navigator.clipboard.writeText(link.full_link ?? '')
    toast.success('¡Link copiado!')
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[380px] bg-white shadow-2xl border-l border-gray-100 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-bold text-gray-900">Estadísticas del link</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Identity */}
        <div>
          <div className="text-xs text-gray-400 mb-0.5">Influencer</div>
          <div className="text-sm font-semibold text-gray-900">
            {link.influencer?.display_name ?? '—'}
          </div>
          {link.campaign && (
            <div className="flex items-center gap-1 mt-1">
              <span className="badge badge-purple text-xs">{link.campaign.name}</span>
            </div>
          )}
          {link.name && (
            <div className="text-xs text-gray-500 mt-1">{link.name}</div>
          )}
        </div>

        {/* Link */}
        <div>
          <div className="text-xs text-gray-400 mb-1.5">Link de afiliado</div>
          <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
            <code className="text-xs text-violet-700 flex-1 truncate">{link.full_link}</code>
            <button
              onClick={copyLink}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-white hover:shadow-sm transition-all"
            >
              <Copy className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>
          <div className="text-xs text-gray-400 mt-1 truncate">
            Destino: {link.redirect_url}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Clicks',       value: (link.clicks ?? 0).toLocaleString('es-CL'),       color: 'blue' },
            { label: 'Conversiones', value: (link.conversions ?? 0).toLocaleString('es-CL'),  color: 'emerald' },
            { label: 'Revenue',      value: formatCurrency(link.revenue ?? 0, 'CLP'),          color: 'amber' },
            { label: 'CTR',          value: `${ctr}%`,                                         color: 'violet' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`p-3 rounded-xl bg-${color}-50 border border-${color}-100`}>
              <div className={`text-lg font-bold text-${color}-700`}>{value}</div>
              <div className={`text-xs text-${color}-500 mt-0.5`}>{label}</div>
            </div>
          ))}
        </div>

        {/* Date */}
        <div className="text-xs text-gray-400">
          Creado el {new Date(link.created_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      <div className="p-5 border-t border-gray-100">
        <a
          href={link.redirect_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Ver URL destino
        </a>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="card overflow-hidden animate-pulse">
      <table className="w-full min-w-[640px]">
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-gray-50">
              {Array.from({ length: 7 }).map((_, j) => (
                <td key={j} className="px-4 py-3.5">
                  <div className="h-3 bg-gray-100 rounded-full" style={{ width: `${40 + (j * 11) % 45}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AffiliatesPage() {
  const [links, setLinks]           = useState<AffiliateLink[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showModal, setShowModal]   = useState(false)
  const [selectedLink, setSelectedLink] = useState<AffiliateLink | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/affiliates')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar links')
      setLinks(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLinks() }, [fetchLinks])

  function handleCreated(link: AffiliateLink) {
    setLinks(prev => [link, ...prev])
    setShowModal(false)
  }

  async function handleDelete(link: AffiliateLink) {
    if (!confirm(`¿Eliminar el link "${link.name ?? link.code}"? Esta acción no se puede deshacer.`)) return
    setDeletingId(link.id)
    try {
      const res = await fetch(`/api/affiliates/${link.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Error al eliminar')
      }
      setLinks(prev => prev.filter(l => l.id !== link.id))
      if (selectedLink?.id === link.id) setSelectedLink(null)
      toast.success('Link eliminado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  function copyLink(link: AffiliateLink, e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(link.full_link ?? '')
    toast.success('¡Link copiado!')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Links de Afiliados</h1>
          <p className="text-sm text-gray-500 mt-0.5">Genera y rastrea links de afiliado para tus influencers</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo Link
        </button>
      </div>

      {/* KPIs */}
      {!loading && !error && <KPICards links={links} />}

      {/* Table */}
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <div className="card p-8 flex flex-col items-center text-center gap-3">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={fetchLinks}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : links.length === 0 ? (
        <div className="card p-12 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center">
            <Link2 className="h-6 w-6 text-violet-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">No hay links aún</p>
            <p className="text-sm text-gray-400 mt-1">Crea el primer link de afiliado para comenzar a rastrear clicks y conversiones.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Crear primer link
          </button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nombre / Influencer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaña</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Link</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Clicks</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Conv.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Revenue</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {links.map(link => (
                <tr
                  key={link.id}
                  onClick={() => setSelectedLink(link)}
                  className="hover:bg-violet-50/30 cursor-pointer transition-colors group"
                >
                  {/* Nombre / Influencer */}
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col">
                      {link.name && (
                        <span className="text-sm font-semibold text-gray-900 truncate max-w-[160px]">{link.name}</span>
                      )}
                      <span className={`text-xs truncate max-w-[160px] ${link.name ? 'text-gray-400' : 'text-sm font-medium text-gray-900'}`}>
                        {link.influencer?.display_name ?? '—'}
                      </span>
                    </div>
                  </td>

                  {/* Campaña */}
                  <td className="px-4 py-3.5">
                    {link.campaign ? (
                      <span className="badge badge-purple text-xs">{link.campaign.name}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>

                  {/* Link */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 max-w-[180px]">
                      <code className="text-xs text-violet-600 truncate flex-1">{link.full_link}</code>
                      <button
                        onClick={e => copyLink(link, e)}
                        className="flex-shrink-0 p-1 rounded hover:bg-violet-100 transition-colors opacity-0 group-hover:opacity-100"
                        title="Copiar link"
                      >
                        <Copy className="h-3 w-3 text-violet-500" />
                      </button>
                    </div>
                  </td>

                  {/* Clicks */}
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900">{(link.clicks ?? 0).toLocaleString('es-CL')}</span>
                  </td>

                  {/* Conversiones */}
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900">{(link.conversions ?? 0).toLocaleString('es-CL')}</span>
                  </td>

                  {/* Revenue */}
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-semibold text-emerald-600">{formatCurrency(link.revenue ?? 0, 'CLP')}</span>
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => copyLink(link, e)}
                        className="p-1.5 rounded-lg hover:bg-violet-100 transition-colors text-gray-400 hover:text-violet-600"
                        title="Copiar link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setSelectedLink(link)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                        title="Ver estadísticas"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(link)}
                        disabled={deletingId === link.id}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-400 hover:text-red-500 disabled:opacity-50"
                        title="Eliminar"
                      >
                        {deletingId === link.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />
                        }
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals / Panels */}
      {showModal && (
        <NewLinkModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {selectedLink && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-30 bg-black/10"
            onClick={() => setSelectedLink(null)}
          />
          <StatsPanel
            link={selectedLink}
            onClose={() => setSelectedLink(null)}
          />
        </>
      )}
    </div>
  )
}
