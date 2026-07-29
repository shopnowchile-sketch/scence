'use client'

import { useState } from 'react'
import { CheckCircle2, Mail } from 'lucide-react'
import { toast } from 'sonner'

type Attendance = {
  id?: string
  type?: string | null
  attendance_response?: string | null
  due_date?: string | null
  influencer?: { id?: string; display_name?: string | null; instagram_username?: string | null } | null
}

function status(response?: string | null) {
  if (response === 'confirmed') return { label: 'Confirmada', className: 'bg-emerald-50 text-emerald-700' }
  if (response === 'declined') return { label: 'No asistirá', className: 'bg-rose-50 text-rose-700' }
  return { label: 'Pendiente', className: 'bg-amber-50 text-amber-700' }
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
  const [open, setOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reminderSelection, setReminderSelection] = useState<Set<string>>(new Set())
  const [reminderSending, setReminderSending] = useState(false)

  const rows = deliverables.filter(d => d.type === 'event_attendance')
  const confirmedRows = rows.filter(d => d.attendance_response === 'confirmed')
  const declinedRows = rows.filter(d => d.attendance_response === 'declined')
  const pendingRows = rows.filter(d => !d.attendance_response && d.influencer?.id)
  const pendingIds = pendingRows.map(row => row.influencer!.id!).filter((id, index, ids) => ids.indexOf(id) === index)
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every(id => reminderSelection.has(id))

  function setReminderSelected(influencerId: string, selected: boolean) {
    setReminderSelection(current => {
      const next = new Set(current)
      if (selected) next.add(influencerId)
      else next.delete(influencerId)
      return next
    })
  }

  async function sendReminders() {
    const influencerIds = Array.from(reminderSelection)
    if (!influencerIds.length) return toast.error('Selecciona al menos una influencer pendiente')
    setReminderSending(true)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/attendance-confirmations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remind', influencer_ids: influencerIds }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? 'No se pudo enviar el recordatorio')
      toast.success(`Recordatorio enviado a ${json.data.sent} influencer${json.data.sent === 1 ? '' : 's'}`)
      setReminderSelection(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar el recordatorio')
    } finally {
      setReminderSending(false)
    }
  }

  async function send() {
    if (!dueDate) return toast.error('Define la fecha límite de confirmación')
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/attendance-confirmations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueDate, message, send_email: sendEmail }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar la solicitud')
      toast.success(rows.length ? 'Plazo de confirmación actualizado' : `Solicitud enviada a ${json.data.created} influencer${json.data.created === 1 ? '' : 's'}`)
      setOpen(false)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar')
    } finally {
      setSaving(false)
    }
  }

  if (!acceptedCount && !rows.length) return null

  return (
    <section className="card border-violet-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Confirmación de asistencia</h3>
          <p className="mt-0.5 text-sm text-gray-500">Envía la solicitud a las influencers aceptadas y controla sus respuestas.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{confirmedRows.length} confirmadas</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{pendingRows.length} pendientes</span>
          {declinedRows.length > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{declinedRows.length} no asistirán</span>}
        </div>
      </div>

      {pendingRows.length > 0 && (
        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-violet-800">{pendingRows.length} confirmación(es) de asistencia pendiente(s)</p>
            {canManage && <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={allPendingSelected} onChange={event => setReminderSelection(event.target.checked ? new Set(pendingIds) : new Set())} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                Seleccionar todas
              </label>
              <button type="button" disabled={!reminderSelection.size || reminderSending} onClick={() => void sendReminders()} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50">
                <Mail className="h-4 w-4" /> {reminderSending ? 'Enviando…' : `Enviar recordatorio (${reminderSelection.size})`}
              </button>
            </div>}
          </div>
          <div className="mt-3 divide-y divide-violet-100 rounded-lg border border-violet-100 bg-white">
            {pendingRows.map((row, index) => {
              const person = row.influencer!
              const personId = person.id!
              const handle = person.instagram_username?.replace(/^@/, '')
              return <label key={row.id ?? personId ?? index} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-violet-50/50">
                {canManage && <input type="checkbox" checked={reminderSelection.has(personId)} onChange={event => setReminderSelected(personId, event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-800">{person.display_name ?? 'Influencer'}</span>{handle && <span className="block truncate text-xs text-violet-600">@{handle}</span>}</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Pendiente</span>
              </label>
            })}
          </div>
        </div>
      )}

      {confirmedRows.length > 0 && <div className="mt-4"><p className="mb-2 text-sm font-semibold text-gray-700">Confirmadas</p><div className="divide-y divide-gray-100 rounded-lg border border-gray-100">{confirmedRows.map((row, index) => { const person = row.influencer; const handle = person?.instagram_username?.replace(/^@/, ''); return <div key={row.id ?? index} className="flex items-center gap-3 px-3 py-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-800">{person?.display_name ?? 'Influencer'}</span>{handle && <span className="block truncate text-xs text-violet-600">@{handle}</span>}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status(row.attendance_response).className}`}>Confirmada</span></div> })}</div></div>}

      {canManage && <button type="button" onClick={() => { setDueDate(rows[0]?.due_date ?? defaultDueDate ?? ''); setOpen(true) }} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" />{rows.length ? 'Editar confirmación' : `Enviar confirmación a ${acceptedCount} influencer${acceptedCount === 1 ? '' : 's'}`}</button>}
      {open && <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-[1fr_2fr_auto]"><label className="text-xs font-medium text-gray-600">Fecha límite<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-base mt-1 w-full" /></label><label className="text-xs font-medium text-gray-600">Mensaje opcional<textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} className="input-base mt-1 w-full resize-none" /></label><div className="flex flex-col justify-end gap-2"><label className="text-xs text-gray-600"><input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} /> Avisar por email</label><button type="button" disabled={saving} onClick={send} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Guardando…' : rows.length ? 'Guardar plazo' : 'Enviar solicitud'}</button></div></div>}
    </section>
  )
}
