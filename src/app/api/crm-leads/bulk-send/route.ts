import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { CRM_EMAIL_CATALOG } from '@/lib/email-catalog'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// POST /api/crm-leads/bulk-send
// Ya NO manda los emails en la misma request (eso causaba el tope de 50 y el
// riesgo de timeout). Ahora crea un job en `crm_bulk_send_jobs` y dispara el
// procesamiento en background (tandas de 50, ver /bulk-send/process). Cuando
// termina, le llega un email de resumen al admin que lo lanzó.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const leadIds = Array.isArray(body.lead_ids)
    ? body.lead_ids.filter((id: unknown) => typeof id === 'string' && id.length > 0)
    : []

  const uniqueIds = Array.from(new Set(leadIds)) as string[]

  if (uniqueIds.length === 0) {
    return NextResponse.json({ error: 'No hay leads seleccionados' }, { status: 422 })
  }

  // Tope de seguridad — mismo límite que ya existe para "seleccionar todos".
  if (uniqueIds.length > 20000) {
    return NextResponse.json({ error: 'Máximo 20.000 leads por job' }, { status: 422 })
  }

  const templateKey = typeof body.template_key === 'string' ? body.template_key : 'crm_intro'
  const template = CRM_EMAIL_CATALOG.find(item => item.key === templateKey)
  if (!template) {
    return NextResponse.json({ error: 'El template seleccionado no está disponible para CRM' }, { status: 422 })
  }

  const subject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim().replace(/[\r\n]+/g, ' ').slice(0, 180)
    : template.defaultSubject

  const customMessage = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 10000)
    : template.defaultMessage ?? ''

  const { data: job, error: jobError } = await admin
    .from('crm_bulk_send_jobs')
    .insert({
      created_by: user.id,
      notify_email: user.email ?? null,
      lead_ids: uniqueIds,
      template_key: template.key,
      subject,
      message: customMessage || null,
      total: uniqueIds.length,
      status: 'pending',
    })
    .select('id')
    .single()

  if (jobError || !job) {
    console.error('[POST /api/crm-leads/bulk-send]', jobError)
    return NextResponse.json({ error: jobError?.message ?? 'No se pudo crear el job' }, { status: 500 })
  }

  const secret = process.env.INTERNAL_JOB_SECRET
  if (!secret) {
    console.error('[POST /api/crm-leads/bulk-send] falta env INTERNAL_JOB_SECRET')
    return NextResponse.json({ error: 'Falta configuración del servidor (INTERNAL_JOB_SECRET)' }, { status: 500 })
  }

  // Dispara la primera tanda en background — waitUntil mantiene viva la
  // función el tiempo necesario para que el fetch salga, aunque ya hayamos
  // respondido al cliente.
  waitUntil(
    fetch(`${APP_URL}/api/crm-leads/bulk-send/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-job-secret': secret },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(err => console.error('[bulk-send] error disparando tanda inicial', err))
  )

  return NextResponse.json({ job_id: job.id, total: uniqueIds.length })
}
