import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// Crea una nueva campaña editable a partir de la configuración de otra.
// Deliberadamente no copia influencers, postulaciones, entregables creados,
// reportes, facturas ni assets: esos elementos pertenecen a la ejecución
// histórica de la campaña original.
export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { data: source, error: sourceError } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (sourceError || !source) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  const brandAccess = await resolveBrandAccess(user.id)
  if (brandAccess) {
    if (!hasBrandPermission(brandAccess, 'campaign.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (source.brand_id !== brandAccess.brandId && source.created_by_brand_id !== brandAccess.brandId) {
      return NextResponse.json({ error: 'Solo la marca creadora puede duplicar esta campaña' }, { status: 403 })
    }
  } else if (!isAdmin && source.organization_id !== orgId) {
    return NextResponse.json({ error: 'No tienes acceso a esta campaña' }, { status: 403 })
  }

  const copyName = `Copia de ${source.name}`
  const { data: campaign, error: insertError } = await admin
    .from('campaigns')
    .insert({
      organization_id: source.organization_id,
      created_by: user.id,
      created_by_brand_id: source.created_by_brand_id ?? null,
      brand_id: source.brand_id ?? null,
      name: copyName,
      description: source.description ?? null,
      brief_url: source.brief_url ?? null,
      type: source.type,
      status: 'draft',
      start_date: source.start_date ?? null,
      end_date: source.end_date ?? null,
      budget_total: source.budget_total ?? null,
      budget_spent: 0,
      currency: source.currency ?? 'CLP',
      goals: source.goals ?? {},
      hashtags: source.hashtags ?? [],
      mention_handles: source.mention_handles ?? [],
      platforms: source.platforms ?? [],
      do_follow_links: source.do_follow_links ?? [],
      content_guidelines: source.content_guidelines ?? null,
      approval_required: source.approval_required ?? true,
      internal_notes: source.internal_notes ?? null,
      tags: source.tags ?? [],
      metadata: source.metadata ?? {},
      deliverable_templates: source.deliverable_templates ?? [],
      campaign_benefits: source.campaign_benefits ?? [],
      application_questions: source.application_questions ?? [],
      visibility: source.visibility ?? 'private',
      application_deadline: source.application_deadline ?? null,
      max_influencers: source.max_influencers ?? null,
      applications_closed_at: null,
      commission_rate: source.commission_rate ?? null,
    })
    .select()
    .single()

  if (insertError || !campaign) {
    console.error('[duplicate campaign]', insertError)
    return NextResponse.json({ error: insertError?.message ?? 'No se pudo crear la copia' }, { status: 500 })
  }

  const [{ data: collaborators }, { data: event }] = await Promise.all([
    admin.from('campaign_brands').select('brand_id').eq('campaign_id', params.id),
    admin.from('bookings').select('title, description, event_type, location, location_details, is_virtual, virtual_link, starts_at, ends_at, fee, currency, travel_covered, travel_budget, wardrobe_provided, notes, internal_notes, metadata').eq('campaign_id', params.id).order('starts_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  if (collaborators?.length) {
    await admin.from('campaign_brands').insert(collaborators.map(row => ({ campaign_id: campaign.id, brand_id: row.brand_id })))
  }

  if (event) {
    const { error: eventError } = await admin.from('bookings').insert({
      campaign_id: campaign.id,
      organization_id: source.organization_id,
      created_by: user.id,
      title: copyName,
      description: event.description ?? null,
      event_type: event.event_type ?? 'event',
      location: event.location ?? null,
      location_details: event.location_details ?? {},
      is_virtual: event.is_virtual ?? false,
      virtual_link: event.virtual_link ?? null,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      fee: event.fee ?? null,
      currency: event.currency ?? 'CLP',
      travel_covered: event.travel_covered ?? false,
      travel_budget: event.travel_budget ?? null,
      wardrobe_provided: event.wardrobe_provided ?? false,
      notes: event.notes ?? null,
      internal_notes: event.internal_notes ?? null,
      metadata: event.metadata ?? {},
      status: 'proposed',
    })
    if (eventError) console.error('[duplicate campaign event]', eventError)
  }

  return NextResponse.json({ data: campaign }, { status: 201 })
}
