import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// PATCH /api/influencer/tasks/[id] — influencer updates their own task status
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Influencers may only update status
  const allowed = ['pending', 'in_progress', 'done', 'skipped']
  if (body.status && !allowed.includes(body.status as string)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Gate por estado de campaña (preasignación en draft): si la tarea está
  // vinculada a un deliverable de una campaña en borrador/revisión, se bloquea
  // aunque se conozca el UUID directamente. Las tareas manuales (sin
  // deliverable) no se bloquean. Se conserva el scope por influencer.
  const { data: task } = await admin
    .from('influencer_tasks')
    .select('id, deliverable_id')
    .eq('id', params.id)
    .eq('influencer_id', influencer.id)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  if (task.deliverable_id) {
    const { data: deliv } = await admin
      .from('campaign_deliverables')
      .select('campaign:campaigns (status)')
      .eq('id', task.deliverable_id)
      .maybeSingle()
    const campSt = String((deliv?.campaign as unknown as { status?: string } | null)?.status ?? '')
    if (campSt === 'draft' || campSt === 'pending_approval') {
      return NextResponse.json({ error: 'Esta campaña aún no está activa' }, { status: 403 })
    }
  }

  const { data, error } = await admin
    .from('influencer_tasks')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('influencer_id', influencer.id) // scope to this influencer only
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
