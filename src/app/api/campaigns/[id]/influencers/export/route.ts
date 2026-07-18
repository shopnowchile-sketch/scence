import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// GET /api/campaigns/[id]/influencers/export
// Descarga datos personales únicamente de participantes aceptadas. Disponible
// para Admin y para la marca dueña/creadora; no para co-marcas de solo lectura.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, organization_id, brand_id, created_by_brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let authorized = false
  if (user.user_metadata?.is_brand) {
    const access = await resolveBrandAccess(user.id)
    authorized = !!access && (
      campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    )
  } else {
    const orgId = await getOrgId(user.id, user.user_metadata, admin)
    const role = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
    authorized = role.isAdmin
  }

  if (!authorized) return NextResponse.json({ error: 'No tienes permiso para descargar estos datos' }, { status: 403 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      fee, currency, accepted_at, updated_at, application_status,
      influencer:influencers (
        display_name, email, phone, whatsapp, commune, categories,
        influencer_social_profiles (platform, username, followers, engagement_rate)
      )
    `)
    .eq('campaign_id', params.id)
    .eq('application_status', 'accepted')
    .order('updated_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Social = { platform: string; username: string | null; followers: number | null; engagement_rate: number | null }
  type Influencer = {
    display_name: string; email: string | null; phone: string | null; whatsapp: string | null
    commune: string | null; categories: string[] | null; influencer_social_profiles: Social[] | null
  }
  const rows = (data ?? []).map(item => {
    const influencer = item.influencer as unknown as Influencer | null
    const instagram = influencer?.influencer_social_profiles?.find(profile => profile.platform === 'instagram')
    return {
      Nombre: influencer?.display_name ?? '',
      Email: influencer?.email ?? '',
      Teléfono: influencer?.phone ?? '',
      WhatsApp: influencer?.whatsapp ?? '',
      Instagram: instagram?.username ? `@${instagram.username.replace(/^@/, '')}` : '',
      Seguidores: instagram?.followers ?? '',
      'Engagement (%)': instagram?.engagement_rate ?? '',
      Comuna: influencer?.commune ?? '',
      Categorías: influencer?.categories?.join(', ') ?? '',
      Estado: 'Seleccionada',
      Fee: item.fee ?? '',
      Moneda: item.currency ?? 'CLP',
      'Fecha de aceptación': item.accepted_at ?? item.updated_at
        ? new Date(item.accepted_at ?? item.updated_at).toLocaleString('es-CL')
        : '',
    }
  })

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SCENCE'
  const worksheet = workbook.addWorksheet('Seleccionadas')
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [
    'Nombre', 'Email', 'Teléfono', 'WhatsApp', 'Instagram', 'Seguidores',
    'Engagement (%)', 'Comuna', 'Categorías', 'Estado', 'Fee', 'Moneda', 'Fecha de aceptación',
  ]
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: [28, 30, 18, 18, 22, 12, 16, 20, 30, 14, 14, 10, 22][index] ?? 18,
  }))
  rows.forEach(row => worksheet.addRow(row))
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: 'A1', to: `M${Math.max(rows.length + 1, 1)}` }
  const output = await workbook.xlsx.writeBuffer()
  const safeName = campaign.name.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '-').replace(/^-|-$/g, '')

  return new NextResponse(new Uint8Array(output), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="influencers-seleccionadas-${safeName || 'campana'}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
