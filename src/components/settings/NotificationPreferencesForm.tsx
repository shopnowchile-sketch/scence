'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Bell } from 'lucide-react'

type NotificationPreferences = {
  public_campaigns_email: boolean
  private_campaigns_email: boolean
  deadline_alerts: boolean
}

const DEFAULTS: NotificationPreferences = {
  public_campaigns_email: true,
  private_campaigns_email: true,
  deadline_alerts: true,
}

const OPTIONS: { key: keyof NotificationPreferences; label: string; help: string }[] = [
  {
    key: 'public_campaigns_email',
    label: 'Campañas abiertas',
    help: 'Avisarme cuando se publique una campaña abierta a la que puede postular cualquier influencer.',
  },
  {
    key: 'private_campaigns_email',
    label: 'Campañas Plan Pro',
    help: 'Avisarme cuando se publique una campaña exclusiva para Plan Pro, y cuando me inviten o asignen a una campaña privada.',
  },
  {
    key: 'deadline_alerts',
    label: 'Alerta de fecha de entrega',
    help: 'Recibir un aviso cuando se acerque la fecha de entrega de un deliverable.',
  },
]

// Componente compartido entre admin-settings, brand-settings e inf-profile.
// Guarda las preferencias dentro de profiles.metadata (sin tabla nueva) vía
// el endpoint ya existente /api/settings/profile.
//
// Los dos toggles de campañas ya están conectados al envío real
// (resolvePendingCampaignAnnouncement en @/lib/campaign-notifications):
// 'open' respeta public_campaigns_email y 'private' respeta
// private_campaigns_email. Apagar los dos = no recibir avisos de campañas.
// deadline_alerts todavía solo persiste la preferencia.
export default function NotificationPreferencesForm() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.json())
      .then(({ data }) => {
        const saved = (data?.metadata as Record<string, unknown> | null)?.notification_preferences as
          Partial<NotificationPreferences> | undefined
        setPrefs({ ...DEFAULTS, ...saved })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setSavingKey(key)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_preferences: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Preferencias actualizadas')
    } catch (err) {
      setPrefs(prefs) // revertir si falla
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    )
  }

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <Bell className="h-4 w-4 text-violet-500" /> Notificaciones por email
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Elige qué avisos quieres recibir por correo. Si apagas los dos tipos de campaña, no te llegará ningún aviso de campañas nuevas.
      </p>

      <div className="divide-y divide-gray-100">
        {OPTIONS.map(({ key, label, help }) => (
          <label key={key} className="flex items-start gap-3 py-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={e => toggle(key, e.target.checked)}
              disabled={savingKey === key}
              className="w-4 h-4 mt-0.5 accent-violet-600 flex-shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{help}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
