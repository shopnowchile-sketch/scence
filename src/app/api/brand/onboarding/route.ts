import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type OnboardingState = {
  skipped_at?: string
  campaign_tour_seen?: boolean
}

function readState(metadata: unknown): OnboardingState {
  if (!metadata || typeof metadata !== 'object') return {}
  const onboarding = (metadata as Record<string, unknown>).brand_onboarding
  return onboarding && typeof onboarding === 'object' ? onboarding as OnboardingState : {}
}

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveBrandAccess(user.id)
  if (!access) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  if (!hasBrandPermission(access, 'campaign.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const [{ data: brand }, { data: profile }, { data: documents }, { data: campaigns }] = await Promise.all([
    admin.from('brands').select('rut, instagram, contact_name, contact_email, address_street, address_city, address_region, address_country, address_place_id').eq('id', access.brandId).single(),
    admin.from('profiles').select('metadata').eq('id', user.id).single(),
    admin.from('brand_documents').select('status, document_type').eq('brand_id', access.brandId).eq('document_type', 'nda'),
    admin.from('campaigns').select('id').eq('brand_id', access.brandId).order('created_at', { ascending: true }).limit(1),
  ])

  const organizationComplete = Boolean(
    brand?.instagram?.trim() && brand?.contact_name?.trim() && brand?.contact_email?.trim() &&
    brand?.rut?.trim() && brand?.address_street?.trim() && brand?.address_city?.trim() &&
    brand?.address_region?.trim() && brand?.address_country?.trim() && brand?.address_place_id?.trim(),
  )
  const ndaSigned = (documents ?? []).some(document => document.status === 'signed')

  return NextResponse.json({
    data: {
      organization_complete: organizationComplete,
      nda_signed: ndaSigned,
      first_campaign_id: campaigns?.[0]?.id ?? null,
      state: readState(profile?.metadata),
    },
  })
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { action?: 'skip' | 'complete_campaign_tour' | 'restart' }
  if (!body.action || !['skip', 'complete_campaign_tour', 'restart'].includes(body.action)) {
    return NextResponse.json({ error: 'Acción de onboarding inválida' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin.from('profiles').select('metadata').eq('id', user.id).single()
  if (profileError || !profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })

  const metadata = profile.metadata && typeof profile.metadata === 'object' ? profile.metadata as Record<string, unknown> : {}
  const state = readState(metadata)
  const nextState: OnboardingState = body.action === 'restart'
    ? {}
    : body.action === 'skip'
      ? { ...state, skipped_at: new Date().toISOString() }
      : { ...state, campaign_tour_seen: true }

  const { error } = await admin.from('profiles').update({ metadata: { ...metadata, brand_onboarding: nextState } }).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: nextState })
}
