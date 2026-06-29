import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { loadScan } from '@/lib/influencers/dataQuality'
import { hardDeleteInfluencers } from '@/lib/influencers/hardDelete'
import { isOrgAdmin } from '@/lib/influencers/authz'

// POST /api/influencers/delete-no-instagram
// body: { dryRun?: boolean }
// Elimina permanentemente influencers SIN Instagram (sin url ni username).
// dryRun=true → solo retorna conteo y preview, no borra.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* sin body ok */ }

  try {
    const scan = await loadScan(admin, orgId)
    const noInstagram = scan.filter(i => !i.instagram_url && !i.instagram_username)
    const ids = noInstagram.map(i => i.id)

    if (body.dryRun) {
      return NextResponse.json({
        dryRun: true,
        count: ids.length,
        preview: noInstagram.slice(0, 20).map(i => ({ id: i.id, display_name: i.display_name, email: i.email })),
      })
    }

    if (!ids.length) return NextResponse.json({ success: true, deleted: 0 })

    if (!(await isOrgAdmin(admin, user.id, orgId))) {
      return NextResponse.json({ error: 'Solo administradores pueden eliminar permanentemente.' }, { status: 403 })
    }
    const result = await hardDeleteInfluencers(admin, orgId, ids)
    return NextResponse.json({ success: true, deleted: result.deleted, childErrors: result.childErrors })
  } catch (e) {
    console.error('[POST delete-no-instagram]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
