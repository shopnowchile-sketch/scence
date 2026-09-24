import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { applyAccept, loadBrandOwnApplication, readApplicationDetails, toBrandProposalView } from '@/lib/brand-proposal'
import { notifyAdminProposalAccepted } from '@/lib/brand-proposal-notify'

type Params = { params: { applicationId: string } }

// Propuesta comercial vista por la MARCA. Aislamiento: toda lectura/escritura
// pasa por loadBrandOwnApplication (filtra por brand_id de la marca
// autenticada). Una marca que pide la propuesta de otra recibe 404.

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'campaign.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const row = await loadBrandOwnApplication(admin, params.applicationId, access.brandId)
  const view = row ? toBrandProposalView(readApplicationDetails(row.details).proposal) : null
  if (!view) return NextResponse.json({ error: 'Propuesta no encontrada' }, { status: 404 })
  return NextResponse.json({ data: { application_id: row!.id, ...view } })
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'campaign.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({})) as { action?: string; confirm?: boolean }
  if (body.action !== 'accept' || body.confirm !== true) return NextResponse.json({ error: 'Confirma la aceptación de la propuesta.' }, { status: 422 })

  const admin = createAdminClient()
  const row = await loadBrandOwnApplication(admin, params.applicationId, access.brandId)
  if (!row || !toBrandProposalView(readApplicationDetails(row.details).proposal)) return NextResponse.json({ error: 'Propuesta no encontrada' }, { status: 404 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const transition = applyAccept(readApplicationDetails(row.details), { userId: user.id, ip })
  const now = new Date().toISOString()
  if (!transition.ok) {
    if (transition.details) {
      // Vencida: se deja registrado el estado 'expired'.
      const { error } = await admin.from('campaign_brand_applications')
        .update({ details: transition.details, updated_at: now })
        .eq('id', row.id).eq('brand_id', access.brandId).eq('updated_at', row.updated_at)
      if (error) console.error('[brand/proposals accept] persist expired', error)
    }
    return NextResponse.json({ error: transition.error }, { status: transition.status })
  }

  const { data: updated, error: updateError } = await admin.from('campaign_brand_applications')
    .update({ details: transition.details, updated_at: now })
    .eq('id', row.id).eq('brand_id', access.brandId).eq('updated_at', row.updated_at)
    .select('id')
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!updated?.length) return NextResponse.json({ error: 'La propuesta cambió. Recarga la página e intenta de nuevo.' }, { status: 409 })

  const { data: campaign } = await admin.from('campaigns').select('id, organization_id').eq('id', row.campaign_id).maybeSingle()
  const { data: brand } = await admin.from('brands').select('name').eq('id', access.brandId).maybeSingle()
  if (campaign) {
    try {
      await notifyAdminProposalAccepted(admin, { organizationId: campaign.organization_id, campaignId: campaign.id, brandName: brand?.name ?? 'La marca', proposal: transition.proposal, applicationId: row.id })
    } catch (error) {
      console.error('[brand/proposals accept] notify', error)
    }
  }
  return NextResponse.json({ data: toBrandProposalView(transition.proposal) })
}
