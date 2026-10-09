import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/server'
import { sendLeadBatch, BATCH_SIZE } from '@/lib/crm-bulk-send'
import { getResend, FROM_EMAIL, bulkSendCompleteEmail } from '@/lib/resend'
import { emailAudience } from '@/lib/inactive-influencer-email-guard'
import { claimJobBatch, finishJobBatch, failJobBatch, type BatchLead } from '@/lib/crm-send-guard'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// Función de larga duración: 1 tanda de 50 emails (con 150ms de espera entre
// cada uno) puede tomar hasta ~20s. Default de Vercel (10s) no alcanza.
export const maxDuration = 60

// POST /api/crm-leads/bulk-send/process — interno, NO expuesto a usuarios.
// Se llama a sí mismo (vía waitUntil) hasta que el job completa. Protegido
// por un secreto compartido en vez de sesión de usuario, porque esta llamada
// es servidor-a-servidor y no lleva cookies de auth.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-job-secret')
  if (!secret || secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  if (!jobId) return NextResponse.json({ error: 'Falta job_id' }, { status: 422 })

  const admin = createAdminClient()

  const { data: job, error: jobError } = await admin
    .from('crm_bulk_send_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    console.error('[bulk-send/process] job no encontrado', jobId, jobError)
    return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 })
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return NextResponse.json({ data: job }) // ya terminado — no reprocesar
  }

  // Bloqueo del job: de dos invocaciones simultáneas solo una procesa la tanda.
  // Además rechaza jobs viejos (no reactiva campañas históricas) sin escribir nada.
  const claim = await claimJobBatch(admin, job)
  if (!claim.ok) {
    if (claim.reason === 'too_old') {
      console.error('[bulk-send/process] job demasiado antiguo — no se procesa', jobId)
      return NextResponse.json({ error: 'Job demasiado antiguo: no se reanuda automáticamente' }, { status: 410 })
    }
    if (claim.reason === 'busy') {
      return NextResponse.json({ data: { id: jobId, status: 'busy' } }, { status: 202 })
    }
    if (claim.reason === 'error') {
      console.error('[bulk-send/process] no se pudo tomar el job', claim.message)
      return NextResponse.json({ error: claim.message ?? 'No se pudo tomar el job' }, { status: 500 })
    }
    return NextResponse.json({ data: job })
  }
  const marker = claim.marker

  const leadIds: string[] = job.lead_ids ?? []
  const batchIds = leadIds.slice(job.cursor, job.cursor + BATCH_SIZE)

  if (batchIds.length === 0) {
    // No debería pasar (cursor >= total ya se marca completed abajo), pero
    // por seguridad cerramos el job igual si llegamos acá sin nada que hacer.
    const closed = await finishJobBatch(admin, jobId, marker, {
      status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    return NextResponse.json({ data: closed.row ?? { ...job, status: 'completed' } })
  }

  const { data: leads, error: leadsError } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, qualification_status, contacted_at')
    .in('id', batchIds)

  if (leadsError) {
    console.error('[bulk-send/process] error cargando leads', leadsError)
    await failJobBatch(admin, jobId, marker, leadsError.message)
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  // FAIL CLOSED: sendLeadBatch consulta la lista de bajas y el ledger del job ANTES
  // de mandar nada. Si alguna consulta falla lanza, y acá se aborta la tanda con el
  // `cursor` intacto. Nunca se avanza en silencio.
  let batchResult: Awaited<ReturnType<typeof sendLeadBatch>>
  try {
    batchResult = await sendLeadBatch(
      admin,
      (leads ?? []) as BatchLead[],
      jobId,
      job.subject,
      job.message ?? '',
      job.created_by,
      job.template_key ?? 'crm_intro',
      job.created_at
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido'
    console.error('[bulk-send/process] tanda abortada sin enviar', error)
    await failJobBatch(admin, jobId, marker, `Tanda abortada sin enviar (cursor ${job.cursor} intacto): ${message}`)
    return NextResponse.json({ error: message }, { status: 503 })
  }

  const { sent, skipped, failed, unconfirmed, recordErrors } = batchResult
  if (unconfirmed > 0 || recordErrors > 0) {
    console.error('[bulk-send/process] tanda con envíos no confirmados o registros incompletos — revisar, NO reenviar', { jobId, unconfirmed, recordErrors })
  }

  const newCursor = job.cursor + batchIds.length
  const isDone = newCursor >= job.total

  // Solo avanza si seguimos teniendo el lease. Si lo perdimos, otra invocación tomó
  // el job: no se pisa su avance ni se encadena una tanda más.
  const finished = await finishJobBatch(admin, jobId, marker, {
    cursor: newCursor,
    sent: job.sent + sent,
    skipped: job.skipped + skipped,
    failed: job.failed + failed,
    status: isDone ? 'completed' : 'processing',
    completed_at: isDone ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  })

  if (!finished.held) {
    console.error('[bulk-send/process] lease perdido al guardar el avance — no se encadena', { jobId, message: finished.message })
    return NextResponse.json({ error: finished.message ?? 'Se perdió el bloqueo del job' }, { status: 409 })
  }
  const updated = finished.row as typeof job

  if (isDone) {
    if (updated.notify_email) {
      try {
        await getResend().emails.send({
          from: FROM_EMAIL,
          to: updated.notify_email, tags: [emailAudience('admin')],
          subject: `Envío masivo CRM terminado — ${updated.sent} enviados`,
          html: bulkSendCompleteEmail({
            total: updated.total,
            sent: updated.sent,
            skipped: updated.skipped,
            failed: updated.failed,
          }),
        })
      } catch (err) {
        console.error('[bulk-send/process] error mandando email de resumen', err)
      }
    }
    return NextResponse.json({ data: updated })
  }

  // Todavía quedan tandas — encadena la siguiente sin bloquear esta respuesta.
  const chainSecret = process.env.INTERNAL_JOB_SECRET
  if (chainSecret) {
    waitUntil(
      fetch(`${APP_URL}/api/crm-leads/bulk-send/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-job-secret': chainSecret },
        body: JSON.stringify({ job_id: jobId }),
      }).catch(err => console.error('[bulk-send/process] error encadenando siguiente tanda', err))
    )
  }

  return NextResponse.json({ data: updated })
}
