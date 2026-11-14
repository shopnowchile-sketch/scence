'use client'

// Dos elecciones de la influencer ACEPTADA: (1) sucursal donde asistirá, si la campaña tiene varias;
// (2) dirección donde recibe cada envío (canje con entrega 'shipping'). Reutiliza las APIs de
// /api/influencer/*: el servidor valida que todo sea suyo. La sugerencia nunca es obligatoria.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type CampaignAddress = { location_id?: string; name: string; address?: string | null; commune: string | null; region: string | null; is_primary: boolean }
type Home = { id: string; name: string; address: string | null; is_primary: boolean }
type Benefit = { id: string; description: string | null; delivery_method: string | null; status: string | null; shipping_location_id: string | null }

export function CampaignLogisticsChoices({ campaignId, locations, attendanceLocationId }: {
  campaignId: string; locations?: CampaignAddress[]; attendanceLocationId?: string | null
}) {
  const [chosen, setChosen] = useState<string | null>(attendanceLocationId ?? null)
  const [homes, setHomes] = useState<Home[]>([])
  const [suggested, setSuggested] = useState<string | null>(null)
  const [shipping, setShipping] = useState<Benefit[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [h, b] = await Promise.all([
      fetch(`/api/influencer/shipping-addresses?campaign_id=${campaignId}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch(`/api/influencer/campaigns/${campaignId}/barters`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ])
    setHomes(h.data ?? [])
    setSuggested(h.suggested_id ?? null)
    const all: Benefit[] = ((b.data ?? []) as Array<{ benefits?: Benefit[] }>).flatMap(x => x.benefits ?? [])
    setShipping(all.filter(x => x.delivery_method === 'shipping'))
  }, [campaignId])
  useEffect(() => { void load() }, [load])

  async function patch(url: string, body: unknown, ok: string) {
    setBusy(true)
    try {
      const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'No se pudo guardar'); return false }
      toast.success(ok); return true
    } finally { setBusy(false) }
  }

  const choices = (locations ?? []).filter(l => l.location_id)
  const showBranch = choices.length >= 2
  if (!showBranch && shipping.length === 0) return null

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-violet-100 bg-violet-50/40 p-4" data-testid="logistics-choices">
      {showBranch && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Elige dónde asistirás</p>
          <div className="mt-2 space-y-2">
            {choices.map(l => (
              <label key={l.location_id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm">
                <input type="radio" name="branch" disabled={busy} checked={chosen === l.location_id} onChange={async () => {
                  if (await patch(`/api/influencer/campaigns/${campaignId}/location`, { location_id: l.location_id }, 'Sucursal elegida')) setChosen(l.location_id!)
                }} />
                <span><span className="font-semibold text-gray-900">{l.name}</span>{l.address ? ` · ${l.address}` : ''}<span className="block text-xs text-gray-500">{[l.commune, l.region].filter(Boolean).join(', ')}</span></span>
              </label>
            ))}
          </div>
        </div>
      )}

      {shipping.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Dirección para recibir tus envíos</p>
          {homes.length === 0 && <p className="mt-1 text-sm text-gray-500">Aún no tienes direcciones. Agrégalas en <a className="font-semibold text-violet-600 underline" href="/inf-profile">Mi perfil → Mis direcciones de envío</a>.</p>}
          {shipping.map(b => (
            <div key={b.id} className="mt-2">
              <label className="mb-1 block text-sm font-semibold text-gray-800">{b.description ?? 'Envío'}</label>
              <select disabled={busy || homes.length === 0 || ['delivered', 'completed'].includes(String(b.status))}
                value={b.shipping_location_id ?? ''}
                onChange={async e => {
                  const id = e.target.value
                  if (id && await patch(`/api/influencer/campaigns/${campaignId}/barters/shipping`, { benefit_id: b.id, location_id: id }, 'Dirección de envío confirmada')) await load()
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona una dirección…</option>
                {homes.map(h => <option key={h.id} value={h.id}>{h.name} · {h.address}{h.id === suggested ? ' (sugerida: más cercana)' : ''}{h.is_primary ? ' (principal)' : ''}</option>)}
              </select>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-gray-400">Solo tú y SCENCE ven tus direcciones. La sugerencia es opcional.</p>
        </div>
      )}
    </div>
  )
}
