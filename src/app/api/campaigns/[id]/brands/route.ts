import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, provisionOrgForBrand, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

function normalizeInstagram(value: unknown) {
  let instagram = String(value ?? '').trim()
  if (!instagram) return null
  try {
    if (/^https?:\/\//i.test(instagram)) {
      const url = new URL(instagram)
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null
      instagram = url.pathname.split('/').filter(Boolean)[0] ?? ''
    }
  } catch {
    return null
  }
  instagram = instagram.replace(/^@/, '').replace(/\/$/, '')
  return /^[a-z0-9._]{1,30}$/i.test(instagram) ? instagram.toLowerCase() : null
}

// POST /api/campaigns/[id]/brands
// Alta de marca colaboradora. Tres modos de body:
//   { instagram, name } — flujo principal: identifica la marca por Instagram.
//     Si no existe, crea su organización y la vincula inmediatamente a la
//     campaña. Sin email queda aprobada; con email queda pendiente sólo para
//     habilitar su portal, sin afectar la campaña ni los tags.
//   { email, name } — flujo nuevo (2026-07-12, pedido de Pri): busca por email
//     (dedup). Si existe una marca con ese email, se asigna directo. Si no
//     existe, se crea una marca liviana + organización propia en
//     status='pending_approval' y se asigna de inmediato. La aprobación sólo
//     controla el acceso de la marca a su portal.
//   { brand_id } — modo legacy (alta directa por id), se mantiene por
//     compatibilidad; no lo usa ninguna UI hoy.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const brandAccess = user.user_metadata?.is_brand ? await resolveBrandAccess(user.id) : null
  const orgId = brandAccess?.organizationId ?? await getOrgId(user.id, user.user_metadata, admin)

  let body: { brand_id?: string; role?: string; email?: string; instagram?: string; name?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.brand_id && !body.email && !body.instagram) {
    return NextResponse.json({ error: 'instagram (o brand_id) requerido' }, { status: 422 })
  }

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 })
  }

  // Mismo criterio que /api/campaigns/[id]: admin/super_admin/owner de Scence,
  // o la marca dueña de la campaña (su organization_id coincide con el de la
  // campaña) puede administrar marcas colaboradoras. Una co-marca (org propia
  // distinta) NO pasa este check — solo la principal o admin gestionan.
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  const ownsCampaign = brandAccess?.brandId === campaign?.brand_id
  if (!campaign || (!isAdmin && !ownsCampaign && (!orgId || campaign.organization_id !== orgId))) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // ── Modo principal: por Instagram ───────────────────────────────────────
  if (body.instagram) {
    const instagram = normalizeInstagram(body.instagram)
    const name = (body.name ?? '').trim()
    const email = body.email?.trim().toLowerCase() || null
    if (!instagram) return NextResponse.json({ error: 'Instagram inválido. Usa @usuario o una URL de Instagram.' }, { status: 422 })
    if (!name) return NextResponse.json({ error: 'name es requerido para crear una marca nueva' }, { status: 422 })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 422 })

    const { data: existingBrand } = await admin
      .from('brands')
      .select('id, name, status, instagram')
      .ilike('instagram', instagram)
      .maybeSingle()

    if (existingBrand) {
      if (campaign.brand_id === existingBrand.id) return NextResponse.json({ error: 'Esta marca ya es la marca principal' }, { status: 409 })
      const { data, error } = await admin
        .from('campaign_brands')
        .upsert({ campaign_id: params.id, brand_id: existingBrand.id, role: 'collaborator', assigned_by: user.id }, { onConflict: 'campaign_id,brand_id' })
        .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url, instagram)')
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ data, matched: true, approved: existingBrand.status === 'approved', pending: existingBrand.status !== 'approved' })
    }

    const newOrgId = await provisionOrgForBrand(name)
    if (!newOrgId) return NextResponse.json({ error: 'No se pudo crear la organización de la marca' }, { status: 500 })
    const { data: newBrand, error: newBrandError } = await admin
      .from('brands')
      .insert({
        organization_id: newOrgId,
        name,
        instagram,
        contact_email: email,
        status: email ? 'pending_approval' : 'approved',
        created_by: user.id,
        metadata: email ? { pending_collab_campaign_id: params.id, invited_by_brand_id: campaign.brand_id, source: 'campaign_collaborator' } : { source: 'campaign_collaborator' },
      })
      .select('id, name, instagram, status')
      .single()
    if (newBrandError) return NextResponse.json({ error: newBrandError.message }, { status: 500 })

    // La marca colaboradora debe formar parte de la campaña de inmediato para
    // que aparezca en el brief y en las instrucciones de tag. Su aprobación
    // sigue siendo necesaria solamente para darle acceso a su propio portal.
    const { data: assignment, error: assignmentError } = await admin
      .from('campaign_brands')
      .upsert({ campaign_id: params.id, brand_id: newBrand.id, role: 'collaborator', assigned_by: user.id }, { onConflict: 'campaign_id,brand_id' })
      .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url, instagram)')
      .single()
    if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 })
    return NextResponse.json({ data: assignment, matched: false, pending: Boolean(email) }, { status: 201 })
  }

  // ── Modo anterior: por email (compatibilidad de API) ─────────────────────
  if (body.email) {
    const email = body.email.trim().toLowerCase()
    const name = (body.name ?? '').trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Email inválido' }, { status: 422 })
    }

    // Buscar por email — única fuente de verdad para dedup. Global (no
    // filtra por org): una marca puede existir bajo cualquier organización.
    const { data: existingBrand } = await admin
      .from('brands')
      .select('id, name, status')
      .ilike('contact_email', email)
      .maybeSingle()

    if (existingBrand) {
      if (campaign.brand_id === existingBrand.id) {
        return NextResponse.json({ error: 'Esta marca ya es la marca principal' }, { status: 409 })
      }

      const { data, error } = await admin
        .from('campaign_brands')
        .upsert({
          campaign_id: params.id,
          brand_id: existingBrand.id,
          role: 'collaborator',
          assigned_by: user.id,
        }, { onConflict: 'campaign_id,brand_id' })
        .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url)')
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ data, matched: true, approved: existingBrand.status === 'approved', pending: existingBrand.status !== 'approved' })
    }

    // Con email queda pendiente para el acceso a su portal, pero se vincula
    // de inmediato a la campaña para poder incluirla en los tags.
    if (!name) {
      return NextResponse.json({ error: 'name es requerido para crear una marca nueva' }, { status: 422 })
    }

    const newOrgId = await provisionOrgForBrand(name)
    if (!newOrgId) {
      return NextResponse.json({ error: 'No se pudo crear la organización de la marca' }, { status: 500 })
    }

    const { data: newBrand, error: newBrandError } = await admin
      .from('brands')
      .insert({
        organization_id: newOrgId,
        name,
        contact_email: email,
        created_by: user.id,
        // Sin `status` explícito a propósito — cae en el default de la
        // columna ('pending_approval'). Este endpoint NUNCA acepta
        // status='approved' desde el body (pedido explícito de Pri).
        metadata: {
          pending_collab_campaign_id: params.id,
          invited_by_brand_id: campaign.brand_id,
        },
      })
      .select('id, name, status')
      .single()

    if (newBrandError) {
      return NextResponse.json({ error: newBrandError.message }, { status: 500 })
    }

    const { data: assignment, error: assignmentError } = await admin
      .from('campaign_brands')
      .upsert({ campaign_id: params.id, brand_id: newBrand.id, role: 'collaborator', assigned_by: user.id }, { onConflict: 'campaign_id,brand_id' })
      .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url, instagram)')
      .single()
    if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 })
    return NextResponse.json({ data: assignment, matched: false, pending: true }, { status: 201 })
  }

  // ── Modo legacy: por brand_id directo ───────────────────────────────────
  if (campaign.brand_id === body.brand_id) {
    return NextResponse.json({ error: 'Esta marca ya es la marca principal' }, { status: 409 })
  }

  const { data: legacyBrand } = await admin
    .from('brands')
    .select('id, status')
    .eq('id', body.brand_id)
    .maybeSingle()

  if (!legacyBrand) {
    return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('campaign_brands')
    .upsert({
      campaign_id: params.id,
      brand_id: body.brand_id,
      role: body.role || 'collaborator',
      assigned_by: user.id,
    }, { onConflict: 'campaign_id,brand_id' })
    .select('id, campaign_id, brand_id, role, brand:brands(id, name, logo_url, website, organization_id)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, matched: true, approved: legacyBrand.status === 'approved', pending: legacyBrand.status !== 'approved' })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const brandAccess = user.user_metadata?.is_brand ? await resolveBrandAccess(user.id) : null
  const orgId = brandAccess?.organizationId ?? await getOrgId(user.id, user.user_metadata, admin)
  const brandId = new URL(req.url).searchParams.get('brand_id')

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id requerido' }, { status: 422 })
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, organization_id, brand_id')
    .eq('id', params.id)
    .maybeSingle()

  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  const ownsCampaign = brandAccess?.brandId === campaign?.brand_id
  if (!campaign || (!isAdmin && !ownsCampaign && (!orgId || campaign.organization_id !== orgId))) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (campaign.brand_id === brandId) {
    return NextResponse.json({ error: 'No se puede quitar la marca principal desde colaboradoras' }, { status: 409 })
  }

  const { error } = await admin
    .from('campaign_brands')
    .delete()
    .eq('campaign_id', params.id)
    .eq('brand_id', brandId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
