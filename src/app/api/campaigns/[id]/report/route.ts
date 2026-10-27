import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// ── GET /api/campaigns/[id]/report ───────────────────────────────────────────
// Returns full campaign data for PDF report generation.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(`
      *,
      brand:brands!brand_id (
        id, name, logo_url, website, contact_name, contact_email, contact_phone
      ),
      campaign_influencers (
        id, fee, status, notes, application_status,
        influencer:influencers (
          id, display_name, avatar_url,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        published_at, published_url, content_url, submitted_at, review_notes, progress,
        performance, metrics_provider, metrics_updated_at, engagement_rate,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .eq('id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    console.error('[GET /api/campaigns/[id]/report]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Administración de plataforma primero (membresía super_admin ACTIVA): un administrador que además es
  // miembro de una marca conserva el acceso global. Los demás usuarios siguen limitados a su marca y campaña.
  let authorized = false
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const access = platformAdmin ? null : await resolveBrandAccess(user.id)
  if (platformAdmin) {
    authorized = true
  } else if (access) {
    const isOwner = campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    const { data: coBrand } = isOwner ? { data: null } : await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', params.id)
      .eq('brand_id', access.brandId)
      .maybeSingle()
    authorized = hasBrandPermission(access, 'report.read') && (isOwner || !!coBrand)
  }
  if (!authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Solo participantes ACEPTADos en el reporte — se excluyen postulantes/
  // invitados pendientes y rechazados (no son parte operativa de la campaña).
  const campaignData = campaign as typeof campaign & {
    campaign_influencers?: Array<{ application_status?: string }>
  }
  if (Array.isArray(campaignData.campaign_influencers)) {
    campaignData.campaign_influencers = campaignData.campaign_influencers.filter(
      (ci: { application_status?: string }) =>
        ci.application_status === 'accepted'
    )
  }

  return NextResponse.json({ data: campaignData })
}
