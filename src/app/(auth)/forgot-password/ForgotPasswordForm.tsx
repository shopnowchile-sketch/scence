'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

const schema = z.object({
  email: z.string().email('Email inválido'),
})
type FormValues = z.infer<typeof schema>

export function ForgotPasswordForm() {
  const supabase = createBrowserClient()
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit({ email }: FormValues) {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="card p-8 shadow-card-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Revisa tu email</h1>
        <p className="text-sm text-gray-500 mb-6">
          Te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y spam).
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm text-violet-600 font-semibold hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al login
        </Link>
      </div>
    )
  }

  return (
    <div className="card p-8 shadow-card-md">
      <h1 className="text-xl font-bold text-gray-900 mb-1">¿Olvidaste tu contraseña?</h1>
      <p className="text-sm text-gray-400 mb-6">
        Ingresa tu email y te enviaremos un enlace para restablecerla.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {loading ? (
            <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          {loading ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-400 mt-6">
        <Link href="/login" className="inline-flex items-center gap-1 text-violet-600 font-semibold hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al login
        </Link>
      </p>
    </div>
  )
}
