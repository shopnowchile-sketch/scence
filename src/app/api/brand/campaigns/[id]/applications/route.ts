import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { syncDeliverableTask } from '@/lib/influencer-tasks'
import { getResend, FROM_EMAIL, campaignApplicationApprovedEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

type Params = { params: { id: string } }

// GET /api/brand-campaigns/[id]/applications
// Lista todas las invitaciones y postulaciones de la campaña
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: brand } = await admin
    .from('brands').select('id').eq('user_id', user.id).single()
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  // Verificar ownership de la campaña
  const { data: campaign } = await admin
    .from('campaigns').select('id, visibility').eq('id', params.id).eq('brand_id', brand.id).single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      id, application_status, origin, message, fee, deliverables_spec, created_at,
      influencer:influencers (
        id, display_name, avatar_url, bio, categories, city, country,
        influencer_social_profiles (platform, username, followers, engagement_rate, is_primary)
      )
    `)
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [], visibility: campaign.visibility })
}

// PATCH /api/brand-campaigns/[id]/applications
// La marca acepta o rechaza una invitación / postulación
// Cuando acepta: crea campaign_deliverables desde deliverables_spec
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const { data: brand } = await admin
    .from('brands').select('id, name').eq('user_id', user.id).single()
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, brand_id, organization_id, status')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let body: { application_id: string; action: 'accept' | 'reject'; agreed_fee?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { application_id, action, agreed_fee } = body
  if (!application_id) return NextResponse.json({ error: 'application_id requerido' }, { status: 422 })
  if (!['accept', 'reject'].includes(action)) return NextResponse.json({ error: 'action debe ser accept o reject' }, { status: 422 })

  // Obtener la aplicación con spec de deliverables
  const { data: applicationRaw } = await admin
    .from('campaign_influencers')
    .select(`
      id, influencer_id, application_status, deliverables_spec, fee,
      influencer:influencers ( display_name, email )
    `)
    .eq('id', application_id)
    .eq('campaign_id', params.id)
    .single()

  const application = applicationRaw as unknown as {
    id: string; influencer_id: string; application_status: string
    deliverables_spec: unknown; fee: number | null
    influencer: { display_name: string; email: string | null } | null
  } | null

  if (!application) return NextResponse.json({ error: 'Aplicación no encontrada' }, { status: 404 })
  if (application.application_status !== 'pending') {
    return NextResponse.json({ error: 'Solo se pueden gestionar aplicaciones pendientes' }, { status: 422 })
  }

  // Actualizar status de la aplicación
  const newStatus = action === 'accept' ? 'accepted' : 'rejected'
  const { error: updateError } = await admin
    .from('campaign_influencers')
    .update({
      application_status: newStatus,
      fee: action === 'accept' ? (agreed_fee ?? application.fee ?? null) : application.fee,
      updated_at: new Date().toISOString(),
    })
    .eq('id', application_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Si acepta: crear deliverables desde deliverables_spec
  if (action === 'accept') {
    try {
      const spec = Array.isArray(application.deliverables_spec)
        ? application.deliverables_spec
        : (typeof application.deliverables_spec === 'string'
            ? JSON.parse(application.deliverables_spec)
            : [])

      if (spec.length > 0) {
        // Evitar duplicados
        const { data: existing } = await admin
          .from('campaign_deliverables')
          .select('id')
          .eq('campaign_id', params.id)
          .eq('influencer_id', application.influencer_id)
          .limit(1)

        if (!existing?.length) {
          const { data: insertedDelivs, error: insertDelErr } = await admin
            .from('campaign_deliverables')
            .insert(
              spec.map((d: { type: string; quantity?: number; platform?: string; due_date?: string }) => ({
                campaign_id:            params.id,
                influencer_id:          application.influencer_id,
                campaign_influencer_id: application_id,
                type:                   d.type,
                title:                  d.type,
                quantity:               d.quantity ?? 1,
                platform:               d.platform ?? null,
                due_date:               d.due_date ?? null,
                status:                 'pending',
              }))
            )
            .select('id, type, title, due_date')

          // Sincronizar cada deliverable con una influencer_task vinculada
          // (mismo patrón que /api/campaigns/[id]/influencers — fix gap encontrado
          // en la auditoría del flujo open/postulación, 2026-07-01)
          if (insertDelErr) {
            console.error('[applications accept] insert deliverables failed:', insertDelErr.message)
          } else if (insertedDelivs?.length) {
            for (const del of insertedDelivs) {
              await syncDeliverableTask(admin, {
                organizationId:    campaign.organization_id,
                influencerId:      application.influencer_id,
                deliverableId:     del.id,
                campaignId:        params.id,
                deliverableType:   del.type,
                deliverableTitle:  del.title,
                deliverableStatus: 'pending',
                dueDate:           del.due_date ?? null,
              })
            }
          }
        }
      }

      // Actualizar status de campaña a 'active' si estaba en draft/pending
      if (['draft', 'pending_influencers'].includes(campaign.status ?? '')) {
        await admin
          .from('campaigns')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', params.id)
      }

      // Email de aprobación al influencer (fix gap encontrado en la auditoría, 2026-07-01)
      // No bloqueante: si falla, la aprobación ya quedó registrada.
      if (application.influencer?.email) {
        try {
          await getResend().emails.send({
            from: FROM_EMAIL,
            to: application.influencer.email,
            subject: `¡Tu postulación a "${campaign.name}" fue aprobada!`,
            html: campaignApplicationApprovedEmail({
              influencerName: application.influencer.display_name,
              campaignName:   campaign.name,
              brandName:      brand.name,
              appUrl:         `${APP_URL}/inf-campaigns`,
            }),
          })
        } catch (e) {
          console.error('[applications accept] approval email non-fatal:', e)
        }
      }
    } catch (e) {
      console.error('[PATCH applications] auto-deliverables failed:', e)
      // Non-fatal
    }
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
