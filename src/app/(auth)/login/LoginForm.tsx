'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { safeInternalPath } from '@/lib/safe-redirect'

const schema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})
type FormValues = z.infer<typeof schema>

export function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = safeInternalPath(searchParams.get('redirect'), '/')
  const urlError     = searchParams.get('error')
  const supabase     = createBrowserClient()

  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [authError, setAuthError] = useState<string | null>(
    urlError === 'auth_confirm_failed' || urlError === 'auth_callback_failed'
      ? 'El enlace del correo venció o ya se usó. Inicia sesión; si tu correo aún no está confirmado, podrás pedir uno nuevo.'
      : null,
  )
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit({ email, password }: FormValues) {
    setLoading(true)
    setAuthError(null)
    setUnconfirmedEmail(null)
    setResendState('idle')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message === 'Email not confirmed') {
        setAuthError('Tu correo aún no está confirmado. Abre el enlace del correo que te enviamos o pide uno nuevo.')
        setUnconfirmedEmail(email)
      } else {
        setAuthError(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message)
      }
      setLoading(false)
      return
    }
    // Detect influencer account → redirect to portal. Si venía de una página del portal
    // de influencers (p. ej. el retorno de PayPal), vuelve ahí; si no, al inicio.
    try {
      const meRes = await fetch('/api/influencer/me')
      if (meRes.ok) {
        router.push(redirect.startsWith('/inf-') ? redirect : '/inf-dash')
        router.refresh()
        return
      }
    } catch { /* not influencer — proceed normally */ }
    router.push(redirect)
    router.refresh()
  }

  async function resendConfirmation() {
    if (!unconfirmedEmail) return
    setResendState('sending')
    try {
      await fetch('/api/auth/resend-confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: unconfirmedEmail }) })
    } catch { /* la respuesta es la misma exista o no la cuenta */ }
    setResendState('sent')
  }

  return (
    <div className="card p-8 shadow-card-md">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Bienvenido de vuelta</h1>
      <p className="text-sm text-gray-400 mb-6">Inicia sesión en tu cuenta</p>

      {authError && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {authError}
          </div>
          {unconfirmedEmail && (
            resendState === 'sent'
              ? <p className="mt-2 text-xs text-red-800">Si tu cuenta está pendiente de confirmar, te enviamos un correo nuevo. Revisa también spam o promociones.</p>
              : <button type="button" onClick={resendConfirmation} disabled={resendState === 'sending'} className="mt-2 text-xs font-semibold text-violet-700 hover:underline disabled:opacity-60">
                  {resendState === 'sending' ? 'Enviando…' : 'Enviarme un nuevo enlace de confirmación'}
                </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            {...register('email')}
            type="email"
            autoComplete="email"
            className="input-base w-full"
            placeholder="tu@empresa.com"
          />
          {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div>
          <div className="flex justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700">Contraseña</label>
            <Link href="/forgot-password" className="text-xs text-violet-600 hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <div className="relative">
            <input
              {...register('password')}
              type={showPwd ? 'text' : 'password'}
              autoComplete="current-password"
              className="input-base w-full pr-10"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {loading ? (
            <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {loading ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-400 mt-6">
        ¿No tienes cuenta?{' '}
        <Link href="/register" className="text-violet-600 font-semibold hover:underline">
          Regístrate
        </Link>
      </p>
    </div>
  )
}
