import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { buildOpportunityConfig } from '@/lib/brand-plans'

type Params = { params: { id: string } }

// PUT /api/campaigns/[id]/collaboration-opportunity
// Guarda la oportunidad para marcas colaboradoras y, desde el modelo de
// planes, `plans[]`. Autorización sin cambios: Admin de plataforma o la marca
// dueña con campaign.manage. Toda la validación de planes vive en
// lib/brand-plans.ts (ids de servidor, sin borrado, textos sin promesas).
export async function PUT(req: NextRequest, { params }: Params) {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(); const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { data: campaign } = await admin.from('campaigns').select('id,brand_id,organization_id,metadata').eq('id', params.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  const access = await resolveBrandAccess(user.id)
  const org = access ? null : await getOrgId(user.id, user.user_metadata, admin)
  const allowed = access
    ? access.brandId === campaign.brand_id && hasBrandPermission(access, 'campaign.manage')
    : Boolean(org && (await getUserRole(user.id, org, admin)).isAdmin)
  if (!allowed) return NextResponse.json({ error: 'Sin permiso para configurar esta campaña' }, { status: 403 })
  const current = campaign.metadata && typeof campaign.metadata === 'object' && !Array.isArray(campaign.metadata) ? campaign.metadata as Record<string, unknown> : {}
  const result = buildOpportunityConfig(current, body)
  if (!result.ok) return NextResponse.json({ error: 'Revisa los planes: hay datos inválidos', errors: result.errors }, { status: 422 })
  const { error } = await admin.from('campaigns').update({ metadata: { ...current, collaboration_opportunity: result.config }, updated_at: new Date().toISOString() }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ data: result.config })
}
