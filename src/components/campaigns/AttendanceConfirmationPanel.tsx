'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

type Attendance = {
  id?: string
  type?: string | null
  attendance_response?: string | null
  due_date?: string | null
  influencer?: { display_name?: string | null; instagram_username?: string | null } | null
}

function attendanceStatus(response?: string | null) {
  if (response === 'confirmed') return { label: 'Aceptó asistencia', className: 'bg-emerald-50 text-emerald-700' }
  if (response === 'declined') return { label: 'No asistirá', className: 'bg-rose-50 text-rose-700' }
  return { label: 'Solicitud enviada · pendiente', className: 'bg-amber-50 text-amber-700' }
}

export function AttendanceConfirmationPanel({ campaignId, acceptedCount, deliverables, defaultDueDate, canManage, onChanged }: { campaignId: string; acceptedCount: number; deliverables: Attendance[]; defaultDueDate: string; canManage: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const rows = deliverables.filter(d => d.type === 'event_attendance')
  const yes = rows.filter(d => d.attendance_response === 'confirmed').length
  const no = rows.filter(d => d.attendance_response === 'declined').length
  const pending = rows.length - yes - no
  async function send() {
    if (!dueDate) return toast.error('Define la fecha límite de confirmación')
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/attendance-confirmations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: dueDate, message, send_email: sendEmail }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar la solicitud')
      toast.success(rows.length ? `Plazo actualizado para ${json.data.updated} confirmación${json.data.updated === 1 ? '' : 'es'} pendiente${json.data.updated === 1 ? '' : 's'}` : `Solicitud enviada a ${json.data.created} influencer${json.data.created === 1 ? '' : 's'}`)
      setOpen(false); onChanged()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Error al enviar') } finally { setSaving(false) }
  }
  if (!acceptedCount && !rows.length) return null
  return <section className="card border-violet-100 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-900">Confirmación de asistencia</h3><p className="mt-0.5 text-xs text-gray-500">Envía la solicitud a las influencers aceptadas. Si no responden antes del plazo, el cupo se libera.</p></div><div className="flex gap-2 text-xs font-semibold"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{yes} confirmadas</span><span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">{pending} pendientes</span><span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{no} no asistirán</span></div></div>{rows.length > 0 && <div className="mt-4 overflow-hidden rounded-xl border border-gray-100"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span>Influencer</span><span>Estado</span></div><div className="divide-y divide-gray-100">{rows.map((row, index) => { const status = attendanceStatus(row.attendance_response); const name = row.influencer?.display_name ?? 'Influencer'; const handle = row.influencer?.instagram_username?.replace(/^@/, ''); return <div key={row.id ?? index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800">{name}</p>{handle && <p className="truncate text-xs text-violet-600">@{handle}</p>}</div><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.class}`}>{status.label}</span></div> })}</div></div>}{canManage && <button type="button" onClick={() => { setDueDate(rows[0]?.due_date ?? defaultDueDate ?? ''); setOpen(true) }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5" />{rows.length ? 'Editar confirmación' : `Enviar confirmación a ${acceptedCount} influencer${acceptedCount === 1 ? '' : 's'}`}</button>}{open && <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-[1fr_2fr_auto]"><label className="text-xs font-medium text-gray-600">Fecha límite<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-base mt-1 w-full" /><span className="mt-1 block text-[11px] text-gray-400">Sugerida: 3 días antes del evento. Editable.</span></label><label className="text-xs font-medium text-gray-600">Mensaje opcional<textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} className="input-base mt-1 w-full resize-none" /></label><div className="flex flex-col justify-end gap-2"><label className="text-xs text-gray-600"><input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} /> Avisar por email</label><button type="button" disabled={saving} onClick={send} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Guardando…' : rows.length ? 'Guardar plazo' : 'Enviar solicitud'}</button></div></div>}</section>
}
