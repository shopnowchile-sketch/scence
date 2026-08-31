'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Building2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

const schema = z.object({
  brand_name:   z.string().min(2, 'Mínimo 2 caracteres').max(100),
  contact_name: z.string().min(2, 'Mínimo 2 caracteres').max(80),
  email:        z.string().email('Email inválido'),
  password:     z.string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Al menos una mayúscula')
    .regex(/[0-9]/, 'Al menos un número'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, {
  message: 'Las contraseñas no coinciden',
  path: ['confirm'],
})

type FormValues = z.infer<typeof schema>

const PWD_RULES = [
  { label: 'Mínimo 8 caracteres',    test: (p: string) => p.length >= 8 },
  { label: 'Al menos una mayúscula', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Al menos un número',     test: (p: string) => /[0-9]/.test(p) },
]

export function BrandRegisterForm() {
  const searchParams = useSearchParams()
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)
  // FIX (2026-07-10): si el correo de confirmación no pudo enviarse, la
  // cuenta y la fila de marca ya quedaron creadas (pending_approval, visible
  // en /admin-brands) — pero no tiene sentido decirle "revisa tu email" si
  // no le llegó nada. Distingue ese caso para mostrar el mensaje correcto.
  const [emailSent, setEmailSent] = useState(true)

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  const pwd = watch('password') ?? ''

  async function onSubmit({ brand_name, contact_name, email, password }: FormValues) {
    setLoading(true)
    setError(null)

    // FIX (2026-07-10): si el navegador ya tenía una sesión activa (marca
    // anterior de una prueba previa, ej. reportado con "Empresa1"), esa
    // sesión seguía viva después de registrar una cuenta nueva — el
    // registro es 100% server-side (admin.auth.admin.createUser) y nunca
    // toca la sesión del navegador. Resultado confuso: se ve "Revisa tu
    // email" pero cualquier otra pestaña/navegación seguía mostrando el
    // portal de la marca vieja. Se cierra la sesión local ANTES de crear la
    // cuenta nueva, para que el navegador quede limpio y sin ambigüedad.
    const supabase = createBrowserClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await supabase.auth.signOut()

    // Vía /api/auth/register-brand (server-side, token_hash) en vez de
    // supabase.auth.signUp() directo — ese flujo dependía del email de
    // confirmación automático de Supabase, que usa PKCE y fallaba si el link
    // se abría en otro navegador/app (mismo bug ya arreglado en recuperación
    // de contraseña e invitaciones).
    let res: Response
    try {
      res = await fetch('/api/auth/register-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_name, contact_name, email, password, referred_by_instagram: searchParams.get('ref') ?? undefined }),
      })
    } catch {
      setError('No pudimos crear tu cuenta. Intenta nuevamente en unos minutos.')
      setLoading(false)
      return
    }

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'No pudimos crear tu cuenta. Intenta nuevamente en unos minutos.')
      setLoading(false)
      return
    }

    // NO navegar al portal — nunca. El registro es server-side y no crea
    // sesión en el navegador, así que no hay a dónde "entrar" todavía de
    // todos modos; esto solo deja explícito que esta pantalla es siempre el
    // final del flujo hasta que la marca confirme el email y sea aprobada.
    const json = await res.json().catch(() => ({}))
    setEmailSent(json.email_sent !== false)
    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="card p-8 text-center shadow-card-md">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${emailSent ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          {emailSent
            ? <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            : <AlertCircle className="h-7 w-7 text-amber-600" />}
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          {emailSent ? '¡Revisa tu email!' : 'Cuenta creada'}
        </h2>
        <p className="text-sm text-gray-500">
          {emailSent
            ? 'Te enviamos un enlace de confirmación. Haz clic en él para activar tu cuenta y acceder al portal de marcas.'
            : 'Tu cuenta quedó creada, pero no pudimos enviarte el correo de confirmación. Contáctanos para que te ayudemos a activarla.'}
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-violet-600 font-semibold hover:underline">
          ← Volver al login
        </Link>
      </div>
    )
  }

  return (
    <div className="card p-8 shadow-card-md">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="h-5 w-5 text-violet-600" />
        <h1 className="text-xl font-bold text-gray-900">Registrar mi marca</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">Accede al portal para gestionar tus campañas</p>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre de la marca</label>
          <input
            {...register('brand_name')}
            className="input-base w-full"
            placeholder="Nike LATAM"
          />
          {errors.brand_name && <p className="text-xs text-red-500 mt-1">{errors.brand_name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre de contacto</label>
          <input
            {...register('contact_name')}
            autoComplete="name"
            className="input-base w-full"
            placeholder="Ana García"
          />
          {errors.contact_name && <p className="text-xs text-red-500 mt-1">{errors.contact_name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            {...register('email')}
            type="email"
            autoComplete="email"
            className="input-base w-full"
            placeholder="ana@marca.com"
          />
          {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña</label>
          <div className="relative">
            <input
              {...register('password')}
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              className="input-base w-full pr-10"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {pwd.length > 0 && (
            <div className="mt-2 space-y-1">
              {PWD_RULES.map(r => (
                <div key={r.label} className={`flex items-center gap-1.5 text-xs ${r.test(pwd) ? 'text-emerald-600' : 'text-gray-400'}`}>
                  <CheckCircle2 className={`h-3 w-3 ${r.test(pwd) ? 'text-emerald-500' : 'text-gray-300'}`} />
                  {r.label}
                </div>
              ))}
            </div>
          )}
          {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmar contraseña</label>
          <input
            {...register('confirm')}
            type={showPwd ? 'text' : 'password'}
            autoComplete="new-password"
            className="input-base w-full"
            placeholder="••••••••"
          />
          {errors.confirm && <p className="text-xs text-red-500 mt-1">{errors.confirm.message}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors mt-2"
        >
          {loading
            ? <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            : <Building2 className="h-4 w-4" />}
          {loading ? 'Creando cuenta…' : 'Crear cuenta de marca'}
        </button>

        <p className="text-xs text-center text-gray-400">
          Al registrarte aceptas nuestros{' '}
          <Link href="/terms" className="text-violet-600 hover:underline">Términos</Link>
          {' '}y{' '}
          <Link href="/privacy" className="text-violet-600 hover:underline">Privacidad</Link>
        </p>
      </form>

      <p className="text-center text-sm text-gray-400 mt-6">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="text-violet-600 font-semibold hover:underline">Iniciar sesión</Link>
      </p>
    </div>
  )
}
