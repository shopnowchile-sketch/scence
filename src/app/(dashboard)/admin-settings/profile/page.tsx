'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, Save, User } from 'lucide-react'

const schema = z.object({
  full_name:    z.string().min(2, 'Mínimo 2 caracteres'),
  display_name: z.string().optional(),
  phone:        z.string().optional(),
  timezone:     z.string().optional(),
  locale:       z.string().optional(),
  signer_rut:   z.string().optional(),
  signer_role:  z.string().optional(),
})
type FormValues = z.infer<typeof schema>

const TIMEZONES = [
  'America/Mexico_City', 'America/Bogota', 'America/Lima',
  'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo', 'America/New_York', 'Europe/Madrid', 'UTC',
]

export default function ProfileSettingsPage() {
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [email, setEmail]       = useState('')
  const pathname = usePathname()
  const isBrandPortal = pathname.startsWith('/brand-settings')

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then(({ data }) => {
        if (data) {
          reset({
            full_name:    data.full_name    ?? '',
            display_name: data.display_name ?? '',
            phone:        data.phone        ?? '',
            timezone:     data.timezone     ?? 'America/Mexico_City',
            locale:       data.locale       ?? 'es',
            signer_rut:   data.signer_rut   ?? '',
            signer_role:  data.signer_role  ?? '',
          })
          setEmail(data.email ?? '')
        }
      })
      .finally(() => setLoading(false))
  }, [reset])

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Perfil actualizado')
      reset(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Avatar placeholder */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="h-4 w-4 text-violet-500" /> Información personal
        </h2>

        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {email.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">{email}</p>
            <p className="text-xs text-gray-400 mt-0.5">Email de acceso — no editable</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <input {...register('full_name')} className="input-base w-full" placeholder="Tu nombre completo" />
            {errors.full_name && <p className="text-xs text-red-500 mt-1">{errors.full_name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre a mostrar</label>
            <input {...register('display_name')} className="input-base w-full" placeholder="Cómo apareces en la app" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Teléfono</label>
            <input {...register('phone')} className="input-base w-full" placeholder="+52 55 0000 0000" type="tel" />
          </div>

          {isBrandPortal && <>
            <div className="col-span-2 pt-3 mt-1 border-t border-gray-100"><p className="text-sm font-semibold text-gray-900">Datos del representante para documentos</p><p className="text-xs text-gray-400 mt-1">Se usarán para completar y firmar los NDA de tu Marca.</p></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">RUT personal</label><input {...register('signer_rut')} className="input-base w-full" placeholder="12.345.678-9" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo / representación</label><input {...register('signer_role')} className="input-base w-full" placeholder="Representante legal" /></div>
          </>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Zona horaria</label>
            <select {...register('timezone')} className="input-base w-full">
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Idioma</label>
            <select {...register('locale')} className="input-base w-full">
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || !isDirty}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}
