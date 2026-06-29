import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { hardDeleteInfluencers } from '@/lib/influencers/hardDelete'
import { isOrgAdmin } from '@/lib/influencers/authz'

// POST /api/influencers/merge
// body: { keepId: string, mergeIds: string[] }
// Combina mergeIds dentro de keepId y luego elimina permanentemente los mergeIds.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })
  if (!(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden combinar/eliminar registros.' }, { status: 403 })
  }

  let body: { keepId?: string; mergeIds?: string[] }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const keepId = body.keepId
  const mergeIds = (body.mergeIds ?? []).filter(id => id && id !== keepId)
  if (!keepId || mergeIds.length === 0) {
    return NextResponse.json({ error: 'keepId y mergeIds son requeridos' }, { status: 400 })
  }

  const allIds = [keepId, ...mergeIds]

  // 1. Cargar registros (scope org)
  const { data: infs, error: loadErr } = await admin
    .from('influencers')
    .select('id, email, phone, city, country, bio, categories, avatar_url, notes')
    .eq('organization_id', orgId)
    .in('id', allIds)
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })

  const keep = infs?.find(i => i.id === keepId)
  if (!keep) return NextResponse.json({ error: 'Registro a conservar no encontrado' }, { status: 404 })
  const merges = (infs ?? []).filter(i => i.id !== keepId)

  // 2. Rellenar campos vacíos del keep con datos de los merges
  const patch: Record<string, unknown> = {}
  const fields = ['email', 'phone', 'city', 'country', 'bio', 'avatar_url', 'notes'] as const
  for (const f of fields) {
    if (!keep[f]) {
      const donor = merges.find(m => m[f])
      if (donor) patch[f] = donor[f]
    }
  }
  if (!keep.categories || keep.categories.length === 0) {
    const cats = new Set<string>()
    merges.forEach(m => (m.categories ?? []).forEach((c: string) => cats.add(c)))
    if (cats.size > 0) patch.categories = Array.from(cats)
  }
  if (Object.keys(patch).length > 0) {
    await admin.from('influencers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', keepId)
  }

  // 3. Reasignar social profiles de plataformas que el keep no tiene
  const { data: keepSPs } = await admin
    .from('influencer_social_profiles').select('platform').eq('influencer_id', keepId)
  const keepPlatforms = new Set((keepSPs ?? []).map(s => s.platform))

  const { data: mergeSPs } = await admin
    .from('influencer_social_profiles').select('id, platform, followers').in('influencer_id', mergeIds)

  const claimed = new Set<string>()
  for (const sp of mergeSPs ?? []) {
    if (keepPlatforms.has(sp.platform) || claimed.has(sp.platform)) continue
    const { error } = await admin
      .from('influencer_social_profiles')
      .update({ influencer_id: keepId, is_primary: false })
      .eq('id', sp.id)
    if (!error) claimed.add(sp.platform)
  }

  // 4. Reasignar referencias de campañas (best-effort; conflictos se ignoran)
  for (const table of ['campaign_influencers', 'campaign_deliverables']) {
    await admin.from(table).update({ influencer_id: keepId }).in('influencer_id', mergeIds)
  }

  // 5. Eliminar permanentemente los merges (limpia hijos sobrantes)
  const result = await hardDeleteInfluencers(admin, orgId, mergeIds)

  return NextResponse.json({
    success: true,
    keepId,
    merged: mergeIds.length,
    deleted: result.deleted,
    fieldsFilled: Object.keys(patch),
    profilesMoved: claimed.size,
  })
}
