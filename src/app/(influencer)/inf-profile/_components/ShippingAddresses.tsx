'use client'

// «Mis direcciones de envío»: lugares privados (locations type=influencer_home) de la propia
// influencer. Reutiliza el selector geográfico y la composición de dirección existentes.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StructuredAddressFields } from '@/components/influencers/StructuredAddressFields'
import { composeAddress, EMPTY_ADDRESS_PARTS, type AddressParts } from '@/lib/address-parts'

type Address = { id: string; name: string; address: string | null; parent_id: string | null; is_primary: boolean }

export function ShippingAddresses() {
  const [items, setItems] = useState<Address[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [parts, setParts] = useState<AddressParts>(EMPTY_ADDRESS_PARTS)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/influencer/shipping-addresses', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    setItems(res.ok ? json.data ?? [] : [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function call(url: string, method: string, body?: unknown, okMsg?: string) {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'No se pudo guardar'); return false }
      if (okMsg) toast.success(okMsg)
      await load()
      return true
    } finally { setBusy(false) }
  }

  async function save() {
    const address = composeAddress(parts)
    if (!name.trim() || !address || !locationId) { toast.error('Completa nombre, comuna y calle'); return }
    const ok = await call('/api/influencer/shipping-addresses', 'POST', { name, address, parent_id: locationId }, 'Dirección guardada')
    if (ok) { setAdding(false); setName(''); setLocationId(''); setParts(EMPTY_ADDRESS_PARTS) }
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5" data-testid="shipping-addresses">
      <h3 className="text-sm font-bold text-gray-900">Mis direcciones de envío</h3>
      <p className="mt-1 text-xs text-gray-500">
        Agrega las direcciones donde puedes recibir productos y canjes de SCENCE. Puedes registrar direcciones en distintas regiones para participar en más campañas y elegir dónde recibir cada envío.
      </p>

      <ul className="mt-4 space-y-2">
        {items?.length === 0 && <li className="text-sm text-gray-400">Aún no tienes direcciones de envío.</li>}
        {items?.map(a => (
          <li key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{a.name}{a.is_primary && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-violet-700">Principal</span>}</p>
              <p className="truncate text-xs text-gray-500">{a.address}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-xs font-semibold">
              {!a.is_primary && <button disabled={busy} onClick={() => void call(`/api/influencer/shipping-addresses/${a.id}`, 'PATCH', { is_primary: true }, 'Dirección principal actualizada')} className="text-violet-600 hover:underline">Hacer principal</button>}
              <button disabled={busy} onClick={() => void call(`/api/influencer/shipping-addresses/${a.id}`, 'DELETE', undefined, 'Dirección desactivada')} className="text-gray-400 hover:text-red-600">Desactivar</button>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Nombre (ej. Casa, Oficina) *</label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400" />
          </div>
          <StructuredAddressFields locationId={locationId} parts={parts} onLocationChange={setLocationId} onPartsChange={setParts} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void save()} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar dirección</button>
            <button disabled={busy} onClick={() => setAdding(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-500">Cancelar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-4 text-sm font-semibold text-violet-600 hover:underline">+ Agregar dirección</button>
      )}
    </section>
  )
}
