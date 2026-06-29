import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/tasks?status=pending
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Resolve influencer id
  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // optional filter

  let query = admin
    .from('influencer_tasks')
    .select('*')
    .eq('influencer_id', influencer.id)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/influencer/tasks]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// POST /api/influencer/tasks — create manual task (admin use)
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { data, error } = await admin
    .from('influencer_tasks')
    .insert({
      organization_id: body.organization_id,
      influencer_id:   body.influencer_id,
      source_type:     body.source_type ?? 'manual',
      source_id:       body.source_id ?? null,
      title:           body.title,
      description:     body.description ?? null,
      due_date:        body.due_date ?? null,
      status:          'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
