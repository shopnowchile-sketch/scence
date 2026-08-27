import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/server'
import { sendLeadBatch, BATCH_SIZE } from '@/lib/crm-bulk-send'
import { getResend, FROM_EMAIL, bulkSendCompleteEmail } from '@/lib/resend'

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

  const leadIds: string[] = job.lead_ids ?? []
  const batchIds = leadIds.slice(job.cursor, job.cursor + BATCH_SIZE)

  if (batchIds.length === 0) {
    // No debería pasar (cursor >= total ya se marca completed abajo), pero
    // por seguridad cerramos el job igual si llegamos acá sin nada que hacer.
    await admin.from('crm_bulk_send_jobs').update({
      status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', jobId)
    return NextResponse.json({ data: { ...job, status: 'completed' } })
  }

  const { data: leads, error: leadsError } = await admin
    .from('crm_leads')
    .select('id, contact_name, company_name, email, qualification_status')
    .in('id', batchIds)

  if (leadsError) {
    console.error('[bulk-send/process] error cargando leads', leadsError)
    await admin.from('crm_bulk_send_jobs').update({
      status: 'failed', error: leadsError.message, updated_at: new Date().toISOString(),
    }).eq('id', jobId)
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  const { sent, skipped, failed } = await sendLeadBatch(
    admin,
    leads ?? [],
    job.subject,
    job.message ?? '',
    job.created_by,
    job.template_key ?? 'crm_intro'
  )

  const newCursor = job.cursor + batchIds.length
  const isDone = newCursor >= job.total

  const { data: updated, error: updateError } = await admin
    .from('crm_bulk_send_jobs')
    .update({
      cursor: newCursor,
      sent: job.sent + sent,
      skipped: job.skipped + skipped,
      failed: job.failed + failed,
      status: isDone ? 'completed' : 'processing',
      completed_at: isDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .single()

  if (updateError) {
    console.error('[bulk-send/process] error guardando avance', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (isDone) {
    if (updated.notify_email) {
      try {
        await getResend().emails.send({
          from: FROM_EMAIL,
          to: updated.notify_email,
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
