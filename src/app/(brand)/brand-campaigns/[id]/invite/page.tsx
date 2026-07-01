'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, Loader2, Instagram } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Influencer {
  id: string
  display_name: string
  avatar_url: string | null
  categories: string[]
  city: string | null
  influencer_social_profiles: { platform: string; username: string; followers: number; is_primary: boolean }[]
  influencer_rate_cards: { deliverable_type: string; base_rate: number; currency: string }[]
}

interface DeliverableItem {
  type: string
  quantity: number
  platform: string
  due_date: string
}

const DELIVERABLE_TYPES = [
  'instagram_post', 'instagram_reel', 'instagram_story',
  'tiktok', 'youtube', 'youtube_short', 'ugc_video', 'ugc_photo',
]

function fmtFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

export default function InviteInfluencerPage() {
  const { id: campaignId } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedId = searchParams.get('influencerId')

  const [influencer, setInfluencer] = useState<Influencer | null>(null)
  const [loading, setLoading]       = useState(false)
  const [sending, setSending]       = useState(false)

  const [fee, setFee]         = useState('')
  const [message, setMessage] = useState('')
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([
    { type: 'instagram_post', quantity: 1, platform: 'instagram', due_date: '' },
  ])

  const loadInfluencer = useCallback(async (infId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brand/influencers/${infId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (json.data) setInfluencer(json.data)
    } catch (e) {
      toast.error((e as Error).message ?? 'Error cargando influencer')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (preselectedId) loadInfluencer(preselectedId)
  }, [preselectedId, loadInfluencer])

  function addDeliverable() {
    setDeliverables(d => [...d, { type: 'instagram_post', quantity: 1, platform: 'instagram', due_date: '' }])
  }

  function removeDeliverable(i: number) {
    setDeliverables(d => d.filter((_, idx) => idx !== i))
  }

  function updateDeliverable(i: number, key: keyof DeliverableItem, value: string | number) {
    setDeliverables(d => d.map((item, idx) => idx === i ? { ...item, [key]: value } : item))
  }

  async function send() {
    if (!influencer) { toast.error('Selecciona un influencer'); return }
    setSending(true)
    try {
      const res = await fetch(`/api/brand/campaigns/${campaignId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencer_id:    influencer.id,
          proposed_fee:     fee ? Number(fee) : undefined,
          message:          message || undefined,
          deliverables_spec: deliverables.map(d => ({
            type:     d.type,
            quantity: d.quantity,
            platform: d.platform || undefined,
            due_date: d.due_date || undefined,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Invitación enviada')
      router.push(`/brand-campaigns/${campaignId}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSending(false)
  }

  const primary = influencer?.influencer_social_profiles?.find(p => p.is_primary)
    ?? influencer?.influencer_social_profiles?.[0]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button
          onClick={() => router.push(`/brand-influencers?campaignId=${campaignId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Volver al catálogo
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Invitar influencer</h1>
        <p className="text-sm text-gray-400 mt-0.5">Define la oferta — el influencer acepta o rechaza</p>
      </div>

      {/* Influencer seleccionado */}
      {loading ? (
        <div className="flex justify-center py-8"><div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>
      ) : influencer ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
          {influencer.avatar_url
            ? <img src={influencer.avatar_url} alt={influencer.display_name} className="w-14 h-14 rounded-full object-cover flex-shrink-0" />
            : <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">{influencer.display_name[0]}</div>
          }
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900">{influencer.display_name}</h3>
            {primary && (
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Instagram className="h-3 w-3" />
                @{primary.username} · {fmtFollowers(primary.followers)} seguidores
              </p>
            )}
            {influencer.categories?.length > 0 && (
              <div className="flex gap-1 mt-1">
                {influencer.categories.slice(0, 3).map(c => (
                  <span key={c} className="text-[10px] capitalize bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{c}</span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => router.push(`/brand-influencers?campaignId=${campaignId}`)}
            className="text-xs text-violet-600 hover:underline flex-shrink-0"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center">
          <p className="text-sm text-gray-400 mb-3">Selecciona un influencer del catálogo</p>
          <button
            onClick={() => router.push(`/brand-influencers?campaignId=${campaignId}`)}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            Ver catálogo
          </button>
        </div>
      )}

      {/* Oferta económica */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="text-sm font-bold text-gray-700">Oferta económica</h2>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tarifa propuesta (CLP)</label>
          <input
            type="number"
            min={0}
            value={fee}
            onChange={e => setFee(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="Ej: 250000"
          />
          <p className="text-xs text-gray-400 mt-1">Deja vacío para negociar directamente</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mensaje para el influencer</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
            placeholder="Presenta la campaña, el producto y el objetivo…"
          />
        </div>
      </div>

      {/* Deliverables */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-700">Entregables solicitados</h2>
          <button
            type="button"
            onClick={addDeliverable}
            className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        </div>

        <div className="space-y-3">
          {deliverables.map((d, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <select
                  value={d.type}
                  onChange={e => updateDeliverable(i, 'type', e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-violet-400 bg-white"
                >
                  {DELIVERABLE_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={d.quantity}
                  onChange={e => updateDeliverable(i, 'quantity', Number(e.target.value))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-violet-400"
                  placeholder="Cantidad"
                />
                <input
                  type="date"
                  value={d.due_date}
                  onChange={e => updateDeliverable(i, 'due_date', e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-violet-400"
                />
                <div className="flex items-center text-xs text-gray-400 px-2">
                  {d.quantity} {d.type.replace(/_/g, ' ')}{d.quantity > 1 ? 's' : ''}
                </div>
              </div>
              {deliverables.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDeliverable(i)}
                  className="p-2 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Botones */}
      <div className="flex gap-3 pb-8">
        <button
          onClick={() => router.push(`/brand-campaigns/${campaignId}`)}
          className="flex-1 py-3 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={send}
          disabled={sending || !influencer}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl transition-colors',
            influencer
              ? 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          )}
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending ? 'Enviando…' : 'Enviar invitación'}
        </button>
      </div>
    </div>
  )
}
