import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeRut } from '@/lib/rut'

/**
 * Al registrarse una influencer o una marca, enlaza su contacto del CRM (mismo email)
 * con el perfil: completa SOLO campos vacíos del perfil con datos del lead, marca el lead
 * como 'converted' (queda fuera de segmentos de captación) y deja una nota en su historial.
 * Reutiliza crm_leads.converted_brand_id y crm_lead_activities; no pisa datos existentes.
 * Best-effort: nunca lanza (no debe romper el registro).
 */
type LeadRow = Record<string, unknown>
const empty = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

export async function linkCrmLeadToProfile(
  admin: SupabaseClient,
  args: { email: string; kind: 'influencer'; userId: string } | { email: string; kind: 'brand'; brandId: string },
): Promise<void> {
  try {
    const email = args.email.trim().toLowerCase()
    if (!email) return
    const { data: leads } = await admin.from('crm_leads').select('*').eq('email', email)
    if (!leads?.length) return

    let profile: LeadRow | null = null
    if (args.kind === 'influencer') {
      profile = (await admin.from('influencers').select('id, phone, location_id').eq('user_id', args.userId).maybeSingle()).data
    } else {
      profile = (await admin.from('brands')
        .select('id, contact_name, contact_phone, website, industry, instagram, address_street, address_city, address_region')
        .eq('id', args.brandId).maybeSingle()).data
    }
    if (!profile) return

    const lead = leads[0] as LeadRow
    const fill: Record<string, unknown> = {}
    const take = (col: string, value: unknown) => { if (empty(profile![col]) && !empty(value)) fill[col] = value }
    if (args.kind === 'influencer') {
      take('phone', lead.phone_1)
      // Ubicación: solo si el perfil no tiene y la comuna del lead existe en `locations`.
      if (empty(profile.location_id) && !empty(lead.commune)) {
        const { data: loc } = await admin.from('locations').select('id').eq('level', 'commune').eq('name', lead.commune as string).limit(1).maybeSingle()
        if (loc?.id) fill.location_id = loc.id
      }
    }
    else {
      take('contact_name', lead.contact_name); take('contact_phone', lead.phone_1)
      take('website', lead.website); take('industry', lead.industry); take('instagram', lead.instagram)
      take('address_street', lead.address); take('address_city', lead.commune); take('address_region', lead.region)
    }
    if (Object.keys(fill).length) await admin.from(args.kind === 'influencer' ? 'influencers' : 'brands').update(fill).eq('id', profile.id as string)

    // RUT de la PERSONA (crm_leads.contact_rut, nunca el de la empresa): se copia solo si el perfil aún no lo tiene.
    const leadRut = normalizeRut(lead.contact_rut)
    if (leadRut) {
      if (args.kind === 'influencer') {
        const { data: priv } = await admin.from('influencer_private_data').select('rut').eq('influencer_id', profile.id as string).maybeSingle()
        if (!priv?.rut) await admin.from('influencer_private_data').upsert({ influencer_id: profile.id as string, rut: leadRut }, { onConflict: 'influencer_id' })
      } else {
        const { data: brandRow } = await admin.from('brands').select('user_id').eq('id', args.brandId).maybeSingle()
        if (brandRow?.user_id) {
          const { data: owner } = await admin.from('profiles').select('signer_rut').eq('id', brandRow.user_id as string).maybeSingle()
          if (owner && empty(owner.signer_rut)) await admin.from('profiles').update({ signer_rut: leadRut }).eq('id', brandRow.user_id as string)
        }
      }
    }

    for (const l of leads as LeadRow[]) {
      if (l.qualification_status === 'converted' && (args.kind === 'influencer' || l.converted_brand_id)) continue
      const patch: Record<string, unknown> = { qualification_status: 'converted' }
      if (args.kind === 'brand' && !l.converted_brand_id) patch.converted_brand_id = args.brandId
      await admin.from('crm_leads').update(patch).eq('id', l.id as string)
      await admin.from('crm_lead_activities').insert({
        lead_id: l.id,
        action_type: 'note',
        description: `Se registró en SCENCE como ${args.kind === 'influencer' ? 'influencer' : 'marca'} (perfil ${profile.id}). Contacto enlazado al perfil.`,
      })
    }
  } catch (error) {
    console.error('[crm-lead-link] no se pudo enlazar el contacto del CRM', error)
  }
}
