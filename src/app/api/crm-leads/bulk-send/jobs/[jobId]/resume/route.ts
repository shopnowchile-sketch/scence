import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { resumeJob } from '@/lib/crm-send-guard'

type Params = { params: { jobId: string } }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// `audit_logs.ip_address` es de tipo inet: un valor inválido haría fallar el registro.
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]{3,39})$/i

// POST /api/crm-leads/bulk-send/jobs/[jobId]/resume — REANUDACIÓN MANUAL, solo admin del CRM.
// Cuerpo: { confirm: true, expected_fingerprint: "<huella de GET …/jobs/[jobId]>" }.
// NO reabre jobs cerrados ni de más de 12 h, NO reenvía los intentos inciertos (los deja registrados
// para revisión manual) y se detiene si no puede determinar con seguridad qué se envió.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!UUID_RE.test(params.jobId)) return NextResponse.json({ error: 'Identificador de job inválido' }, { status: 422 })

  const body = await req.json().catch(() => ({})) as { confirm?: unknown; expected_fingerprint?: unknown }
  if (typeof body.expected_fingerprint !== 'string' || !body.expected_fingerprint) {
    return NextResponse.json({ error: 'Falta expected_fingerprint: consulta primero el estado del job' }, { status: 422 })
  }

  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const result = await resumeJob(admin, {
    jobId: params.jobId,
    userId: user.id,
    confirm: body.confirm === true,
    expectedFingerprint: body.expected_fingerprint,
    meta: { ip: forwarded && IP_RE.test(forwarded) ? forwarded : null, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code, blockers: result.blockers, report: result.report }, { status: result.status })
  }

  // Las decisiones ya quedaron registradas y el bloqueo liberado. Recién ahora se dispara el procesador
  // (el mismo que usa la creación del job), que continúa desde el cursor con todas las protecciones.
  const secret = process.env.INTERNAL_JOB_SECRET
  if (!secret) {
    console.error('[bulk-send/resume] falta INTERNAL_JOB_SECRET — decisiones registradas pero el procesador NO se disparó', params.jobId)
    return NextResponse.json({ error: 'Decisiones registradas, pero falta la configuración del servidor para continuar (INTERNAL_JOB_SECRET)', decisions: result.decisions.length }, { status: 500 })
  }
  waitUntil(
    fetch(`${APP_URL}/api/crm-leads/bulk-send/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-job-secret': secret },
      body: JSON.stringify({ job_id: params.jobId }),
    }).catch(err => console.error('[bulk-send/resume] error disparando el procesador', err)),
  )

  return NextResponse.json({
    data: {
      job_id: params.jobId,
      resumed_by: user.id,
      interrupted_attempts: result.decisions.map(d => ({ lead_id: d.leadId, resolution: d.resolution })),
      retried_automatically: 0,
      remaining: result.report.job.remaining,
      ...(result.auditWarning ? { audit_warning: result.auditWarning } : {}),
    },
  })
}
