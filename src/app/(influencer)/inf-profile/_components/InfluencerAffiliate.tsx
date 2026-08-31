'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Link2, MousePointerClick, Users } from 'lucide-react'
import { toast } from 'sonner'

type Affiliate = { full_link: string; clicks: number; conversions: number }

export function InfluencerAffiliate() {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetch('/api/influencer/affiliate').then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setAffiliate(result.data) }).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar tu link.')) }, [])

  async function copyLink() {
    if (!affiliate) return
    await navigator.clipboard.writeText(affiliate.full_link)
    toast.success('Link copiado.')
  }

  if (error) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{error}</div>
  if (!affiliate) return <div className="py-10 text-center text-sm text-gray-400">Creando tu link…</div>

  return <div className="mx-auto max-w-3xl space-y-4">
    <section className="rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 p-6 text-white"><div className="flex items-center gap-2"><Link2 className="h-5 w-5" /><h2 className="text-lg font-bold">Recomienda SCENCE</h2></div><p className="mt-2 text-sm text-violet-100">Comparte tu link con marcas que quieran trabajar con influencers.</p><div className="mt-4 flex rounded-xl bg-white p-1"><input readOnly value={affiliate.full_link} className="min-w-0 flex-1 bg-transparent px-3 text-sm text-gray-700 outline-none" /><button onClick={copyLink} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white"><Copy className="h-4 w-4" /> COPIAR</button></div></section>
    <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl border border-gray-100 bg-white p-4"><MousePointerClick className="h-5 w-5 text-violet-600" /><strong className="mt-2 block text-2xl text-gray-900">{affiliate.clicks}</strong><span className="text-xs text-gray-500">Visitas a tu link</span></div><div className="rounded-2xl border border-gray-100 bg-white p-4"><Users className="h-5 w-5 text-emerald-600" /><strong className="mt-2 block text-2xl text-gray-900">{affiliate.conversions}</strong><span className="text-xs text-gray-500">Registros atribuidos</span></div></div>
    <section className="rounded-2xl border border-gray-100 bg-white p-5"><h3 className="font-bold text-gray-900">Cómo funciona</h3><div className="mt-3 space-y-2 text-sm text-gray-600"><p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-violet-600" />Copia y comparte tu link en Instagram, WhatsApp o email.</p><p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-violet-600" />La marca se registra directamente desde tu enlace.</p><p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-violet-600" />SCENCE registra automáticamente las visitas y marcas referidas.</p></div></section>
  </div>
}
