import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// GET /api/influencer/me
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('influencers')
    .select(`
      id, display_name, avatar_url, bio, email, phone, city, country,
      address, commune, categories, tags, is_verified, organization_id,
      influencer_social_profiles (id, platform, username, followers, engagement_rate, profile_url)
    `)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Influencer profile not found' }, { status: 404 })
  return NextResponse.json({ data })
}

// PATCH /api/influencer/me
export async function PATCH(req: Request) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()

  const { data: influencer } = await admin
    .from('influencers')
    .select('id, address, commune')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Allowed profile fields
  const profileUpdate: Record<string, unknown> = {}
  const allowed = ['display_name', 'bio', 'phone', 'city', 'country', 'address', 'commune', 'avatar_url', 'categories']
  for (const key of allowed) {
    if (key in body) profileUpdate[key] = body[key]
  }

  // Perfil obligatorio (portal influencer): Instagram + comuna + dirección.
  // Se valida el estado FINAL resultante (existente + lo que llega en este
  // PATCH) antes de escribir nada, para que no se pueda vaciar estos campos
  // ni saltarse el requisito llamando el endpoint directo. Ver ProfileCompletionGate.
  const finalAddress = 'address' in profileUpdate ? String(profileUpdate.address ?? '').trim() : String(influencer.address ?? '').trim()
  const finalCommune = 'commune' in profileUpdate ? String(profileUpdate.commune ?? '').trim() : String(influencer.commune ?? '').trim()

  let finalHasInstagram: boolean
  if (Array.isArray(body.social_profiles)) {
    const { data: existingSocials } = await admin
      .from('influencer_social_profiles')
      .select('id, platform, username')
      .eq('influencer_id', influencer.id)
    const byId = new Map((existingSocials ?? []).map(sp => [sp.id, sp]))
    const touchedIds = new Set<string>()
    const finalSocials: { platform: string; username: string | null }[] = []

    for (const sp of body.social_profiles) {
      if (sp.id) touchedIds.add(sp.id)
      if (sp._delete) continue
      if (!sp.platform) continue
      finalSocials.push({ platform: sp.platform, username: sp.username ?? null })
    }
    for (const existing of existingSocials ?? []) {
      if (!touchedIds.has(existing.id)) finalSocials.push({ platform: existing.platform, username: existing.username })
    }
    finalHasInstagram = finalSocials.some(sp => sp.platform === 'instagram' && String(sp.username ?? '').trim().length > 0)
  } else {
    const { data: existingSocials } = await admin
      .from('influencer_social_profiles')
      .select('platform, username')
      .eq('influencer_id', influencer.id)
    finalHasInstagram = (existingSocials ?? []).some(sp => sp.platform === 'instagram' && String(sp.username ?? '').trim().length > 0)
  }

  const missing: string[] = []
  if (!finalAddress) missing.push('dirección')
  if (!finalCommune) missing.push('comuna')
  if (!finalHasInstagram) missing.push('Instagram')
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Faltan campos obligatorios: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error: upErr } = await admin
      .from('influencers')
      .update(profileUpdate)
      .eq('id', influencer.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // Handle social profiles upsert/delete
  if (Array.isArray(body.social_profiles)) {
    for (const sp of body.social_profiles) {
      if (!sp.platform) continue
      if (sp._delete && sp.id) {
        await admin.from('influencer_social_profiles').delete().eq('id', sp.id).eq('influencer_id', influencer.id)
        continue
      }
      if (sp.id) {
        await admin.from('influencer_social_profiles').update({
          username: sp.username ?? null,
          profile_url: sp.profile_url ?? null,
          followers: sp.followers ?? 0,
          engagement_rate: sp.engagement_rate ?? null,
        }).eq('id', sp.id).eq('influencer_id', influencer.id)
      } else {
        await admin.from('influencer_social_profiles').insert({
          influencer_id: influencer.id,
          platform: sp.platform,
          username: sp.username ?? null,
          profile_url: sp.profile_url ?? null,
          followers: sp.followers ?? 0,
          engagement_rate: sp.engagement_rate ?? null,
        })
      }
    }
  }

  const { data: updated } = await admin
    .from('influencers')
    .select(`
      id, display_name, avatar_url, bio, email, phone, city, country,
      address, commune, categories, tags, is_verified,
      influencer_social_profiles (id, platform, username, followers, engagement_rate, profile_url)
    `)
    .eq('id', influencer.id)
    .single()

  return NextResponse.json({ data: updated })
}
