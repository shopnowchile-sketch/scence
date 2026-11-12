import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { planJobRecovery, createRecoveryJob } from '@/lib/crm-send-guard'

type Params = { params: { jobId: string } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]{3,39})$/i

async function authorize(jobId: string) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (!UUID_RE.test(jobId)) return { error: NextResponse.json({ error: 'Identificador de job inválido' }, { status: 422 }) }
  return { user, admin }
}

// GET /api/crm-leads/bulk-send/jobs/[jobId]/recover — solo lectura: cuántos pendientes están verificados y por qué se excluye el resto.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorize(params.jobId)
  if ('error' in auth) return auth.error
  const planned = await planJobRecovery(auth.admin, params.jobId)
  if (!planned.ok) return NextResponse.json({ error: planned.message }, { status: planned.status })
  const { eligible, ...summary } = planned.plan
  return NextResponse.json({ data: { ...summary, eligible: eligible.length } })
}

// POST — crea un job NUEVO (pending) solo con los pendientes verificados. NO envía nada y NO toca el job original:
// el envío se inicia después con «Reanudar envío» sobre el job nuevo (mismas protecciones y confirmación).
// Cuerpo: { confirm: true, expected_eligible: <número que viste en el GET> }.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorize(params.jobId)
  if ('error' in auth) return auth.error
  const body = await req.json().catch(() => ({})) as { confirm?: unknown; expected_eligible?: unknown }
  if (!Number.isInteger(body.expected_eligible)) return NextResponse.json({ error: 'Falta expected_eligible: consulta primero la lista' }, { status: 422 })

  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const result = await createRecoveryJob(auth.admin, {
    jobId: params.jobId, userId: auth.user.id, userEmail: auth.user.email ?? null,
    confirm: body.confirm === true, expectedEligible: body.expected_eligible as number,
    meta: { ip: forwarded && IP_RE.test(forwarded) ? forwarded : null, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
  })
  if (!result.ok) return NextResponse.json({ error: result.message, new_job_id: result.newJobId }, { status: result.status })
  const { eligible, ...summary } = result.plan
  return NextResponse.json({ data: { new_job_id: result.newJobId, total: eligible.length, ...summary } })
}
