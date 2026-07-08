'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Form mínimo para que una marca agregue una influencer a su propio roster.
 * A diferencia de NewInfluencerForm (admin, 4 pasos: datos/redes/tarifas/
 * confirmar), acá solo se pide lo necesario para identificarla y contactarla.
 * Todo lo demás (bio, categorías, tarifas, redes adicionales, verificación)
 * lo completa la propia influencer cuando entra a su perfil — pedido por Pri:
 * "no se le debería pedir bio ni nada, solo email instagram teléfono
 * dirección, todo lo otro lo rellena la influencer".
 */
export function BrandNewInfluencerForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    display_name: '',
    instagram: '',
    email: '',
    phone: '',
    address: '',
  })

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.display_name.trim()) return toast.error('El nombre es requerido')
    if (!form.instagram.trim()) return toast.error('Instagram es requerido')

    setSaving(true)
    try {
      const res = await fetch('/api/brand/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          social_profiles: [{
            platform: 'instagram',
            username: form.instagram.trim().replace(/^@/, ''),
            followers_count: 0,
            engagement_rate: 0,
            is_primary: true,
          }],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo agregar la influencer')
      toast.success('Influencer agregada a tu roster')
      router.push('/brand-influencers')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <button
          onClick={() => router.push('/brand-influencers')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Agregar influencer</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Solo lo básico para identificarla — ella completa el resto (bio, redes, tarifas) al entrar a su perfil.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre *</label>
          <input
            value={form.display_name}
            onChange={e => set('display_name', e.target.value)}
            required
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="Valentina Reyes"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Instagram *</label>
          <input
            value={form.instagram}
            onChange={e => set('instagram', e.target.value)}
            required
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="@usuario o usuario"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="influencer@email.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Teléfono</label>
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="+56 9 1234 5678"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Dirección</label>
          <input
            value={form.address}
            onChange={e => set('address', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            placeholder="Calle, comuna, ciudad"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push('/brand-influencers')}
            className="flex-1 py-2.5 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Agregando…' : 'Agregar influencer'}
          </button>
        </div>
      </form>
    </div>
  )
}
