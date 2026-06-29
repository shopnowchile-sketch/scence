import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { loadScan, findDuplicates } from '@/lib/influencers/dataQuality'

// GET /api/influencers/duplicates — grupos de duplicados por email / instagram_url / instagram
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const typeFilter = new URL(req.url).searchParams.get('type') // email | instagram_url | instagram

  try {
    const scan = await loadScan(admin, orgId)
    let groups = findDuplicates(scan)
    if (typeFilter) groups = groups.filter(g => g.type === typeFilter)
    return NextResponse.json({
      groups,
      totalGroups: groups.length,
      totalDuplicateRecords: groups.reduce((s, g) => s + (g.influencers.length - 1), 0),
    })
  } catch (e) {
    console.error('[GET duplicates]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
