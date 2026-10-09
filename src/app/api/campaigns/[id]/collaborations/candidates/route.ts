import { NextRequest, NextResponse } from 'next/server'
import { authorizeCollaborationAdmin } from '@/lib/campaign-collaborations'

type Params = { params: { id: string } }

// GET /api/campaigns/[id]/collaborations/candidates?q= — busca leads CRM y
// marcas existentes que aún no están asociados a la campaña.
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin } = auth

  // Se quitan los caracteres con significado en filtros PostgREST (, . ( ) % *).
  const q = (new URL(req.url).searchParams.get('q') ?? '').replace(/[,.()%*\\]/g, ' ').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ leads: [], brands: [] })
  const like = `%${q}%`

  const [leadsRes, brandsRes, linkedRes] = await Promise.all([
    admin.from('crm_leads')
      .select('id, company_name, contact_name, email, instagram, industry, converted_brand_id')
      .or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},instagram.ilike.${like}`)
      .order('company_name', { ascending: true })
      .limit(15),
    admin.from('brands')
      .select('id, name, logo_url, contact_name, contact_email, instagram, industry')
      .or(`name.ilike.${like},contact_name.ilike.${like},contact_email.ilike.${like},instagram.ilike.${like}`)
      .order('name', { ascending: true })
      .limit(15),
    admin.from('campaign_brand_collaborations').select('lead_id, brand_id').eq('campaign_id', params.id),
  ])
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 })
  if (brandsRes.error) return NextResponse.json({ error: brandsRes.error.message }, { status: 500 })
  if (linkedRes.error) return NextResponse.json({ error: linkedRes.error.message }, { status: 500 })

  const linkedLeads = new Set((linkedRes.data ?? []).map(r => r.lead_id).filter(Boolean))
  const linkedBrands = new Set((linkedRes.data ?? []).map(r => r.brand_id).filter(Boolean))
  const leads = (leadsRes.data ?? []).filter(l => !linkedLeads.has(l.id) && !(l.converted_brand_id && linkedBrands.has(l.converted_brand_id)))
  const convertedBrandIds = new Set(leads.map(l => l.converted_brand_id).filter(Boolean))
  // Una marca ya representada por un lead convertido no se ofrece dos veces.
  const brands = (brandsRes.data ?? []).filter(b => !linkedBrands.has(b.id) && !convertedBrandIds.has(b.id))

  return NextResponse.json({ leads, brands })
}
