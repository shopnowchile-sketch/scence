import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_ROLES } from '@/lib/supabase/ensureOrg'
import {
  COLLAB_SELECT,
  planBelongsToCampaign,
  authorizeCollaborationAdmin,
  hydrateCollaborations,
  loadCollaboratorImportPlan,
} from '@/lib/campaign-collaborations'

type Params = { params: { id: string } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/campaigns/[id]/collaborations — marcas colaboradoras comerciales de
// la campaña + responsables posibles. Solo admin de plataforma.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin } = auth

  const [rowsRes, membersRes, plansRes] = await Promise.all([
    admin.from('campaign_brand_collaborations').select(COLLAB_SELECT).eq('campaign_id', params.id).order('created_at', { ascending: false }),
    admin.from('organization_members').select('user_id').eq('is_active', true).in('role', ADMIN_ROLES),
    admin.from('campaign_collaboration_plans').select('id, campaign_id, name, amount, description, sort_order').eq('campaign_id', params.id).order('sort_order').order('created_at'),
  ])
  if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 500 })
  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 500 })
  if (plansRes.error) return NextResponse.json({ error: plansRes.error.message }, { status: 500 })

  const ownerIds = Array.from(new Set((membersRes.data ?? []).map(m => m.user_id as string)))
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await admin.from('profiles').select('id, full_name, display_name').in('id', ownerIds)
    : { data: [], error: null }
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 })

  try {
    const data = await hydrateCollaborations(admin, rowsRes.data ?? [])
    // Aviso opcional: si falla no debe impedir ver la ficha.
    const importPlan = await loadCollaboratorImportPlan(admin, params.id).catch(() => ({ toInsert: [], needsReview: [] }))
    const owners = (profiles ?? []).map(p => ({ id: p.id as string, name: (p.display_name || p.full_name || 'Admin') as string }))
    return NextResponse.json({ data, owners, plans: plansRes.data ?? [], importable: importPlan.toInsert.length, import_review: importPlan.needsReview.length })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al cargar colaboraciones' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/collaborations — asocia un lead o marca YA existente.
// Crear un lead nuevo se hace con el flujo CRM actual (POST /api/crm-leads) y
// luego se asocia por lead_id: aquí no se crean marcas ni leads.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin, userId } = auth

  const body = await req.json().catch(() => ({}))
  let leadId: string | null = typeof body.lead_id === 'string' ? body.lead_id : null
  let brandId: string | null = typeof body.brand_id === 'string' ? body.brand_id : null
  if (!leadId && !brandId) return NextResponse.json({ error: 'lead_id o brand_id requerido' }, { status: 422 })
  const planId: string | null = typeof body.plan_id === 'string' ? body.plan_id : null
  if (planId && !(UUID_RE.test(planId) && await planBelongsToCampaign(admin, params.id, planId))) {
    return NextResponse.json({ error: 'Plan inválido para esta campaña' }, { status: 422 })
  }
  if ((leadId && !UUID_RE.test(leadId)) || (brandId && !UUID_RE.test(brandId))) {
    return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 })
  }

  if (leadId) {
    const { data: lead, error } = await admin.from('crm_leads').select('id, converted_brand_id').eq('id', leadId).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })
    brandId = brandId ?? lead.converted_brand_id ?? null
  }
  if (brandId) {
    const { data: brand, error } = await admin.from('brands').select('id').eq('id', brandId).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
    if (!leadId) {
      // Si la marca vino de un lead convertido, se usa ese lead para notas/historial.
      const { data: converted } = await admin.from('crm_leads').select('id').eq('converted_brand_id', brandId).limit(1).maybeSingle()
      leadId = converted?.id ?? null
    }
  }

  // Evita duplicar la asociación por cualquiera de las dos identidades.
  const identity = [leadId && `lead_id.eq.${leadId}`, brandId && `brand_id.eq.${brandId}`].filter(Boolean).join(',')
  const { data: existing, error: existingError } = await admin
    .from('campaign_brand_collaborations').select('id').eq('campaign_id', params.id).or(identity).limit(1)
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (existing?.length) return NextResponse.json({ error: 'Esta marca ya está asociada a la campaña' }, { status: 409 })

  const { data, error } = await admin
    .from('campaign_brand_collaborations')
    .insert({ campaign_id: params.id, lead_id: leadId, brand_id: brandId, plan_id: planId, owner_id: userId, created_by: userId })
    .select(COLLAB_SELECT)
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Esta marca ya está asociada a la campaña' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const [hydrated] = await hydrateCollaborations(admin, [data])
  return NextResponse.json({ data: hydrated }, { status: 201 })
}
