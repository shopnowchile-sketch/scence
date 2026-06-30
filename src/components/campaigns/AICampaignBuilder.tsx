'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Sparkles, Loader2, ChevronRight, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'Facebook', 'LinkedIn', 'Pinterest', 'Twitch']

const OBJECTIVES = [
  { value: 'awareness',     label: 'Awareness',       desc: 'Dar a conocer la marca o producto' },
  { value: 'consideration', label: 'Consideración',   desc: 'Generar interés y evaluación' },
  { value: 'conversion',    label: 'Conversión',       desc: 'Ventas, registros o descargas' },
  { value: 'engagement',    label: 'Engagement',       desc: 'Comunidad y fidelización' },
  { value: 'loyalty',       label: 'Lealtad',          desc: 'Retener y premiar clientes' },
]

interface FormData {
  company_name: string
  what_they_sell: string
  target_audience: string
  location: string
  main_objective: string
  budget: string
  social_platforms: string[]
  extra_info: string
}

const INITIAL: FormData = {
  company_name: '', what_they_sell: '', target_audience: '',
  location: '', main_objective: '', budget: '',
  social_platforms: [], extra_info: '',
}

export function AICampaignBuilder({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [form, setForm]       = useState<FormData>(INITIAL)
  const [step, setStep]       = useState<'form' | 'generating' | 'done'>('form')
  const [error, setError]     = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  function set(key: keyof FormData, value: string | string[]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function togglePlatform(p: string) {
    set('social_platforms',
      form.social_platforms.includes(p)
        ? form.social_platforms.filter(x => x !== p)
        : [...form.social_platforms, p]
    )
  }

  const isValid =
    form.company_name.trim() &&
    form.what_they_sell.trim() &&
    form.target_audience.trim() &&
    form.location.trim() &&
    form.main_objective &&
    form.budget.trim() &&
    form.social_platforms.length > 0

  async function handleGenerate() {
    if (!isValid) return
    setStep('generating')
    setError(null)
    setProgress(0)

    // Animated progress while waiting for Claude
    const timer = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 12, 88))
    }, 400)

    try {
      const res = await fetch('/api/campaigns/ai-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          social_platforms: form.social_platforms.map(p => p.toLowerCase().replace('/','_').replace(' ','_')),
        }),
      })

      clearInterval(timer)

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error generando campaña')
      }

      const json = await res.json()
      setProgress(100)
      setStep('done')

      toast.success('¡Campaña generada! Redirigiendo al editor…')
      setTimeout(() => {
        onClose()
        router.push(`/admin-campaigns/${json.data.id}/edit`)
      }, 900)

    } catch (e: unknown) {
      clearInterval(timer)
      setStep('form')
      setError(e instanceof Error ? e.message : 'Error inesperado')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={step === 'form' ? onClose : undefined} />

      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">AI Campaign Builder</h2>
              <p className="text-violet-200 text-xs">Describe tu marca, Scence crea la campaña</p>
            </div>
          </div>
          {step === 'form' && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Generating state */}
        {step === 'generating' && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-violet-100 flex items-center justify-center">
                <Sparkles className="h-9 w-9 text-violet-600 animate-pulse" />
              </div>
              <div className="absolute -top-1 -right-1">
                <Loader2 className="h-5 w-5 text-violet-500 animate-spin" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">Analizando tu marca…</h3>
            <p className="text-sm text-gray-400 text-center mb-8 max-w-xs">
              Scence está generando la estrategia de campaña perfecta para {form.company_name}
            </p>
            {/* Progress bar */}
            <div className="w-full max-w-xs bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 text-xs text-gray-300 text-center">
              {progress < 30 ? 'Analizando información de la marca…' :
               progress < 55 ? 'Diseñando estrategia de influencers…' :
               progress < 75 ? 'Generando brief y KPIs…' :
               progress < 90 ? 'Creando la campaña en Scence…' :
               'Casi listo…'}
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">¡Campaña creada!</h3>
            <p className="text-sm text-gray-400 text-center">Redirigiendo al editor…</p>
          </div>
        )}

        {/* Form */}
        {step === 'form' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {error && (
                <div className="flex items-start gap-3 p-3.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Row 1: company + sells */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nombre empresa *</label>
                  <input
                    value={form.company_name}
                    onChange={e => set('company_name', e.target.value)}
                    placeholder="Ej: Natura, Lacoste…"
                    className="input-base text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Qué vende *</label>
                  <input
                    value={form.what_they_sell}
                    onChange={e => set('what_they_sell', e.target.value)}
                    placeholder="Ej: skincare natural…"
                    className="input-base text-sm w-full"
                  />
                </div>
              </div>

              {/* Público + Ubicación */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Público objetivo *</label>
                  <input
                    value={form.target_audience}
                    onChange={e => set('target_audience', e.target.value)}
                    placeholder="Ej: mujeres 25-35, fitness…"
                    className="input-base text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ciudad / País *</label>
                  <input
                    value={form.location}
                    onChange={e => set('location', e.target.value)}
                    placeholder="Ej: México, LATAM…"
                    className="input-base text-sm w-full"
                  />
                </div>
              </div>

              {/* Objetivo */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Objetivo principal *</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {OBJECTIVES.map(obj => (
                    <button
                      key={obj.value}
                      onClick={() => set('main_objective', obj.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-xl border text-center transition-all',
                        form.main_objective === obj.value
                          ? 'border-violet-500 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      )}
                    >
                      <span className="text-[10px] font-semibold leading-tight">{obj.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Presupuesto */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Presupuesto aproximado *</label>
                <input
                  value={form.budget}
                  onChange={e => set('budget', e.target.value)}
                  placeholder="Ej: $5,000 USD, $20,000 MXN, flexible…"
                  className="input-base text-sm w-full"
                />
              </div>

              {/* Plataformas */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Redes sociales * <span className="text-gray-400 font-normal">(selecciona al menos 1)</span></label>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map(p => (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                        form.social_platforms.includes(p)
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extra info */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Información adicional <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={form.extra_info}
                  onChange={e => set('extra_info', e.target.value)}
                  placeholder="Lanzamiento de producto, evento especial, restricciones de contenido, competidores a evitar…"
                  rows={2}
                  className="input-base text-sm w-full resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
              <p className="text-xs text-gray-400">~3 seg · Crea un Draft en Campaigns</p>
              <button
                onClick={handleGenerate}
                disabled={!isValid}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
                  isValid
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 shadow-md shadow-violet-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                <Sparkles className="h-4 w-4" />
                Generar campaña
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
