import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/payments
// Returns payroll items for this influencer: pending + completed.
export async function GET() {
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

  const { data, error } = await admin
    .from('payroll_items')
    .select(`
      id, status, gross_amount, net_amount, currency,
      paid_at, description, payment_reference, created_at,
      payroll_run:payroll_runs (id, period_label, paid_at),
      campaign_influencer:campaign_influencers (
        campaign:campaigns (id, name)
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[GET /api/influencer/payments]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pending   = (data ?? []).filter((p: { status: string }) => p.status !== 'paid')
  const completed = (data ?? []).filter((p: { status: string }) => p.status === 'paid')

  return NextResponse.json({ pending, completed, total: data?.length ?? 0 })
}
