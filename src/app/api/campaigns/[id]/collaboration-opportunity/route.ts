import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { isCampaignBrandCollaborator } from '@/lib/campaign-brand-access'
type Params = { params: { id: string } }
export async function PUT(req: NextRequest, { params }: Params) {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(); const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const { data: campaign } = await admin.from('campaigns').select('id,brand_id,created_by_brand_id,organization_id,metadata').eq('id', params.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
  // Administración de plataforma primero (super_admin ACTIVO); marca: dueña, creadora o colaboradora de ESTA campaña,
  // con campaign.manage y el estado que lo permita.
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const access = platformAdmin ? null : await resolveBrandAccess(user.id)
  const isCollaborator = Boolean(access && hasBrandPermission(access, 'campaign.manage')
    && await isCampaignBrandCollaborator(admin, params.id, access.brandId))
  const allowed = platformAdmin || Boolean(access && hasBrandPermission(access, 'campaign.manage')
    && (access.brandId === campaign.brand_id || access.brandId === campaign.created_by_brand_id || isCollaborator))
  if (!allowed) return NextResponse.json({ error: 'Sin permiso para configurar esta campaña' }, { status: 403 })
  const current = campaign.metadata && typeof campaign.metadata === 'object' ? campaign.metadata as Record<string, unknown> : {}
  const config = { enabled: Boolean(body.enabled), benefits: String(body.benefits ?? '').trim(), participation_value: Math.max(0, Number(body.participation_value) || 0), currency: body.currency === 'USD' ? 'USD' : 'CLP', seats: Math.max(0, Math.trunc(Number(body.seats) || 0)), application_deadline: body.application_deadline || null }
  const { error } = await admin.from('campaigns').update({ metadata: { ...current, collaboration_opportunity: config }, updated_at: new Date().toISOString() }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 }); return NextResponse.json({ data: config })
}
