import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { JOB_MAX_AGE_MS, parseLease } from '@/lib/crm-send-guard'

// GET /api/crm-leads/bulk-send/jobs — SOLO LECTURA, solo admin del CRM.
// Lista los últimos envíos masivos (sin la lista de leads) para la pantalla "Envíos masivos".
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('crm_bulk_send_jobs')
    .select('id, status, subject, template_key, total, cursor, sent, skipped, failed, error, created_at, updated_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = Date.now()
  const jobs = (data ?? []).map(job => {
    const lease = parseLease(job.error)
    const open = job.status === 'pending' || job.status === 'processing'
    const ageMs = now - new Date(job.created_at).getTime()
    return {
      id: job.id,
      status: job.status as string,
      subject: job.subject as string,
      template_key: job.template_key as string,
      total: job.total as number,
      cursor: job.cursor as number,
      sent: job.sent as number,
      skipped: job.skipped as number,
      failed: job.failed as number,
      created_at: job.created_at as string,
      updated_at: job.updated_at as string,
      completed_at: (job.completed_at ?? null) as string | null,
      // El marcador interno de bloqueo NO se expone; solo si hay alguien procesando ahora.
      busy: Boolean(lease && lease.expiresAt.getTime() > now),
      // Una nota humana (p. ej. el cierre de auditoría) sí se muestra; el marcador técnico no.
      note: job.error && !lease ? String(job.error).slice(0, 240) : null,
      reviewable: open && ageMs <= JOB_MAX_AGE_MS,
    }
  })
  return NextResponse.json({ data: jobs })
}
