import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

function opportunity(metadata: unknown) {
  const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const value = meta.collaboration_opportunity
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'campaign.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const { data: campaigns, error } = await admin.from('campaigns')
    .select('id,name,type,start_date,end_date,application_deadline,brand_id,metadata,brand:brands!brand_id(id,name,logo_url,instagram)')
    .eq('status', 'active').neq('brand_id', access.brandId).order('start_date', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: applications } = await admin.from('campaign_brand_applications').select('campaign_id,status').eq('brand_id', access.brandId)
  const applicationByCampaign = new Map((applications ?? []).map(row => [row.campaign_id, row.status]))
  return NextResponse.json({ data: (campaigns ?? []).flatMap(c => {
    const config = opportunity(c.metadata)
    if (!config?.enabled) return []
    return [{ ...c, collaboration_opportunity: config, application_status: applicationByCampaign.get(c.id) ?? null }]
  }) })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'campaign.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { campaign_id?: string; sampling?: string; activation_details?: string; links?: string }
  if (!body.campaign_id) return NextResponse.json({ error: 'campaign_id requerido' }, { status: 422 })
  const admin = createAdminClient()
  const { data: brand } = await admin.from('brands').select('id,name,instagram,contact_email,contact_name,metadata').eq('id', access.brandId).single()
  const meta = brand?.metadata && typeof brand.metadata === 'object' ? brand.metadata as Record<string, unknown> : {}
  const hasBilling = Boolean(meta.legal_name || meta.rut || meta.tax_id || meta.billing_email)
  if (!brand?.name || !brand.instagram || !brand.contact_email || !brand.contact_name || !hasBilling) {
    return NextResponse.json({ error: 'Completa tu perfil comercial: Instagram, nombre, contacto y datos de facturación.' }, { status: 422 })
  }
  const { data: campaign } = await admin.from('campaigns').select('id,brand_id,status,metadata').eq('id', body.campaign_id).single()
  const config = opportunity(campaign?.metadata)
  if (!campaign || campaign.status !== 'active' || campaign.brand_id === brand.id || !config?.enabled) return NextResponse.json({ error: 'Esta campaña no está disponible para marcas colaboradoras.' }, { status: 409 })
  if (config.application_deadline && new Date(String(config.application_deadline)) < new Date()) return NextResponse.json({ error: 'La postulación ya cerró.' }, { status: 409 })
  const { data, error } = await admin.from('campaign_brand_applications')
    .upsert({
      campaign_id: campaign.id,
      brand_id: brand.id,
      status: 'pending',
      details: {
        sampling: String(body.sampling ?? '').trim() || null,
        activation_details: String(body.activation_details ?? '').trim() || null,
        links: String(body.links ?? '').trim() || null,
      },
    }, { onConflict: 'campaign_id,brand_id' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
