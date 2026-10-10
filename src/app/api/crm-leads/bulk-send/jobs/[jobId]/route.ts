import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isCrmAdmin } from '@/lib/crm-auth'
import { inspectJob } from '@/lib/crm-send-guard'

type Params = { params: { jobId: string } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/crm-leads/bulk-send/jobs/[jobId] — SOLO LECTURA, solo admin del CRM.
// Estado actual del job para decidir si se reanuda: confirmados, fallidos definitivos, inciertos,
// intentos interrumpidos y bloqueos. Devuelve la huella (`fingerprint`) que exige la reanudación.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!UUID_RE.test(params.jobId)) return NextResponse.json({ error: 'Identificador de job inválido' }, { status: 422 })

  const result = await inspectJob(admin, params.jobId)
  if (!result.ok) return NextResponse.json({ error: result.blockers[0]?.message ?? 'No disponible', blockers: result.blockers }, { status: result.status })
  return NextResponse.json({ data: result.report })
}
