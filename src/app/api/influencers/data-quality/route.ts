import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { loadScan, findDuplicates, buildReport } from '@/lib/influencers/dataQuality'

// GET /api/influencers/data-quality — métricas de calidad de datos del roster
export async function GET(_req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  try {
    const scan = await loadScan(admin, orgId)
    const groups = findDuplicates(scan)
    return NextResponse.json({ report: buildReport(scan, groups) })
  } catch (e) {
    console.error('[GET data-quality]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
