import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

/**
 * POST /api/influencer/link
 * Links the authenticated user to an influencer record and marks them as influencer
 * in their user_metadata so middleware can do fast role-based routing.
 *
 * Body: { influencer_id?: string }
 * - If influencer_id is provided, sets user_id on that influencer row.
 * - If omitted, just checks that a row with this user_id already exists.
 * Either way, updates user_metadata.is_influencer = true.
 */
export async function POST(request: Request) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  let body: { influencer_id?: string } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  // If influencer_id provided, link the user to that specific influencer row
  if (body.influencer_id) {
    const { error: linkError } = await admin
      .from('influencers')
      .update({ user_id: user.id })
      .eq('id', body.influencer_id)

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 500 })
    }
  } else {
    // Verify a row with this user_id already exists
    const { data: existing, error: checkError } = await admin
      .from('influencers')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (checkError || !existing) {
      return NextResponse.json(
        { error: 'No influencer record found for this user. Provide influencer_id to link.' },
        { status: 404 }
      )
    }
  }

  // Update user_metadata to mark as influencer (enables fast middleware routing)
  const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, is_influencer: true },
  })

  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'User linked as influencer.' })
}
