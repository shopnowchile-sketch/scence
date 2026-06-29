import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

// PATCH /api/brand/deliverables/[id]/review — marca aprueba o rechaza contenido
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Resolver brand
  const { data: brand } = await admin
    .from('brands')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  let body: { action: 'approve' | 'reject'; review_notes?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, review_notes } = body
  if (!action || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action debe ser approve o reject' }, { status: 422 })
  }

  // Verificar que el deliverable pertenece a una campaña de esta marca
  const { data: deliverable } = await admin
    .from('campaign_deliverables')
    .select('id, campaign_id, status')
    .eq('id', params.id)
    .single()

  if (!deliverable) return NextResponse.json({ error: 'Deliverable no encontrado' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, brand_id')
    .eq('id', deliverable.campaign_id)
    .eq('brand_id', brand.id)
    .single()

  if (!campaign) {
    return NextResponse.json({ error: 'No tienes acceso a este deliverable' }, { status: 403 })
  }

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('campaign_deliverables')
    .update({
      status:      action === 'approve' ? 'approved' : 'rejected',
      review_notes: review_notes ?? null,
      reviewed_at: now,
      updated_at:  now,
    })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
