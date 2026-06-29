import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { getResend, FROM_EMAIL, deliverableStatusEmail } from '@/lib/resend'

// POST /api/emails/deliverable-status — notify influencer of approve/reject
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { deliverable_id, status, review_notes } = body as {
    deliverable_id: string
    status: 'approved' | 'rejected'
    review_notes?: string
  }

  if (!deliverable_id || !['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'deliverable_id and valid status are required' }, { status: 422 })
  }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  const { data: deliverable } = await admin
    .from('campaign_deliverables')
    .select(`
      title,
      campaign:campaigns (id, name, organization_id),
      influencer:influencers (display_name, email)
    `)
    .eq('id', deliverable_id)
    .single()

  type DelRow = {
    title: string
    campaign: { id: string; name: string; organization_id: string } | null
    influencer: { display_name: string; email: string | null } | null
  }
  const d = deliverable as DelRow | null

  if (!d || (orgId && d.campaign?.organization_id !== orgId)) {
    return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })
  }

  if (!d.influencer?.email) {
    return NextResponse.json({ error: 'Influencer has no email address' }, { status: 422 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence.vercel.app'
  const deliverableUrl = `${appUrl}/campaigns/${d.campaign?.id}`

  const { data, error } = await getResend().emails.send({
    from:    FROM_EMAIL,
    to:      d.influencer.email,
    subject: status === 'approved'
      ? `✅ Tu contenido fue aprobado — ${d.campaign?.name}`
      : `❌ Tu contenido necesita ajustes — ${d.campaign?.name}`,
    html: deliverableStatusEmail({
      influencerName:  d.influencer.display_name,
      deliverableTitle: d.title,
      campaignName:    d.campaign?.name ?? '',
      status,
      reviewNotes:     review_notes,
      deliverableUrl,
    }),
  })

  if (error) {
    console.error('[POST /api/emails/deliverable-status]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, sent_to: d.influencer.email })
}
