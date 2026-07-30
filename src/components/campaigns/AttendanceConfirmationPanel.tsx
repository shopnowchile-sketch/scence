'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Attendance = {
  id?: string
  type?: string | null
  attendance_response?: string | null
  due_date?: string | null
  influencer?: { id?: string; display_name?: string | null; instagram_username?: string | null } | null
}

type Props = {
  campaignId: string
  acceptedCount: number
  deliverables: Attendance[]
  defaultDueDate: string
  canManage: boolean
  onChanged: () => void
}

export function AttendanceConfirmationPanel({
  campaignId, acceptedCount, deliverables, defaultDueDate, canManage, onChanged,
}: Props) {
  const rows = deliverables.filter(d => d.type === 'event_attendance')
  const currentDueDate = rows[0]?.due_date ?? defaultDueDate ?? ''
  const [dueDate, setDueDate] = useState(currentDueDate)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDueDate(currentDueDate)
  }, [currentDueDate])

  async function send() {
    if (!dueDate) return toast.error('Define la fecha límite de confirmación')
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/attendance-confirmations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Cambiar el plazo nunca dispara correos. Los recordatorios se envían
        // solo a las influencers seleccionadas en la tabla de aprobadas.
        body: JSON.stringify({ due_date: dueDate, send_email: false }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar la solicitud')
      toast.success(rows.length ? 'Plazo de confirmación actualizado' : 'Plazo de confirmación guardado')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar')
    } finally {
      setSaving(false)
    }
  }

  if (!acceptedCount && !rows.length) return null

  return canManage ? (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 pb-3">
      <label className="text-xs font-semibold text-gray-600">Fecha límite de confirmación
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-base ml-2 w-auto py-1.5 text-sm" />
      </label>
      <button type="button" disabled={saving || !dueDate} onClick={send} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar fecha'}
      </button>
    </div>
  ) : null
}
