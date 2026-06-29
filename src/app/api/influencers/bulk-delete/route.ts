import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { hardDeleteInfluencers } from '@/lib/influencers/hardDelete'
import { isOrgAdmin } from '@/lib/influencers/authz'

// POST /api/influencers/bulk-delete
// body: { ids: string[], hard?: boolean }
// hard=true → borrado permanente (cascada). hard=false → desactiva.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: { ids?: string[]; hard?: boolean }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const ids = (body.ids ?? []).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
  if (ids.length > 5000) return NextResponse.json({ error: 'Max 5000 ids per request' }, { status: 400 })

  // ── Desactivar (soft) ──────────────────────────────────────────────────────
  if (body.hard !== true) {
    const { data, error } = await admin
      .from('influencers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .in('id', ids)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, hard: false, deactivated: data?.length ?? 0 })
  }

  // ── Borrado permanente (solo admins) ───────────────────────────────────────
  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden eliminar permanentemente.' }, { status: 403 })
  }
  try {
    const result = await hardDeleteInfluencers(admin, orgId, ids)
    return NextResponse.json({
      success: true,
      hard: true,
      deleted: result.deleted,
      requested: ids.length,
      childErrors: result.childErrors,
    })
  } catch (e) {
    console.error('[POST bulk-delete]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error al borrar' }, { status: 500 })
  }
}
