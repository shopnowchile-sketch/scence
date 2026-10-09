import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'
import type { CollaborationRow } from '@/lib/campaign-collaborations-shared'

export * from '@/lib/campaign-collaborations-shared'

export const COLLAB_SELECT =
  'id, campaign_id, lead_id, brand_id, status, collaboration_type, contribution_detail, quantity, next_step, follow_up_date, owner_id, created_at, updated_at'

type AuthResult =
  | { ok: true; userId: string; admin: SupabaseClient }
  | { ok: false; response: NextResponse }

/**
 * Solo admin de plataforma (organization_members, vía isPlatformAdmin) y solo
 * sobre una campaña existente. Las colaboraciones comerciales son datos
 * internos: nunca se exponen al portal de marca ni de influencer.
 */
export async function authorizeCollaborationAdmin(campaignId: string): Promise<AuthResult> {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const { data: campaign, error } = await admin.from('campaigns').select('id').eq('id', campaignId).maybeSingle()
  if (error) return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) }
  if (!campaign) return { ok: false, response: NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 }) }

  return { ok: true, userId: user.id, admin }
}

interface LeadLite {
  id: string
  company_name: string | null
  contact_name: string | null
  position: string | null
  email: string | null
  phone_1: string | null
  instagram: string | null
  industry: string | null
}

interface BrandLite {
  id: string
  name: string | null
  logo_url: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  instagram: string | null
  industry: string | null
}

type RawCollab = Omit<CollaborationRow,
  'name' | 'logo_url' | 'contact_name' | 'contact_position' | 'contact_email' | 'contact_phone' | 'instagram' | 'industry' | 'owner_name'>

/** Une colaboraciones con lead/marca/responsable en 3 consultas fijas (sin N+1). */
export async function hydrateCollaborations(admin: SupabaseClient, rows: RawCollab[]): Promise<CollaborationRow[]> {
  const leadIds = Array.from(new Set(rows.map(r => r.lead_id).filter((v): v is string => !!v)))
  const brandIds = Array.from(new Set(rows.map(r => r.brand_id).filter((v): v is string => !!v)))
  const ownerIds = Array.from(new Set(rows.map(r => r.owner_id).filter((v): v is string => !!v)))

  const [leadsRes, brandsRes, ownersRes] = await Promise.all([
    leadIds.length
      ? admin.from('crm_leads').select('id, company_name, contact_name, position, email, phone_1, instagram, industry').in('id', leadIds)
      : Promise.resolve({ data: [] as LeadLite[], error: null }),
    brandIds.length
      ? admin.from('brands').select('id, name, logo_url, contact_name, contact_email, contact_phone, instagram, industry').in('id', brandIds)
      : Promise.resolve({ data: [] as BrandLite[], error: null }),
    ownerIds.length
      ? admin.from('profiles').select('id, full_name, display_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; display_name: string | null }[], error: null }),
  ])
  if (leadsRes.error) throw new Error(leadsRes.error.message)
  if (brandsRes.error) throw new Error(brandsRes.error.message)
  if (ownersRes.error) throw new Error(ownersRes.error.message)

  const leads = new Map((leadsRes.data as LeadLite[]).map(l => [l.id, l]))
  const brands = new Map((brandsRes.data as BrandLite[]).map(b => [b.id, b]))
  const owners = new Map((ownersRes.data as { id: string; full_name: string | null; display_name: string | null }[])
    .map(o => [o.id, o.display_name || o.full_name || null]))

  return rows.map(row => {
    const lead = row.lead_id ? leads.get(row.lead_id) : undefined
    const brand = row.brand_id ? brands.get(row.brand_id) : undefined
    return {
      ...row,
      name: brand?.name || lead?.company_name || lead?.contact_name || lead?.email || lead?.instagram || 'Sin nombre',
      logo_url: brand?.logo_url ?? null,
      contact_name: lead?.contact_name ?? brand?.contact_name ?? null,
      contact_position: lead?.position ?? null,
      contact_email: lead?.email ?? brand?.contact_email ?? null,
      contact_phone: lead?.phone_1 ?? brand?.contact_phone ?? null,
      instagram: lead?.instagram ?? brand?.instagram ?? null,
      industry: lead?.industry ?? brand?.industry ?? null,
      owner_name: row.owner_id ? owners.get(row.owner_id) ?? null : null,
    }
  })
}
