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
      address, commune, birth_date, categories, tags, is_verified, organization_id,
      influencer_social_profiles (id, platform, username, followers, engagement_rate, profile_url)
    `)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Influencer profile not found' }, { status: 404 })

  // Marcas referidas: cuenta brands cuyo metadata.referred_by_instagram matchea
  // el Instagram de esta influencer. Se calcula en vivo (no es un contador
  // guardado) para no desincronizarse. Ver "¿Quién te invitó?" en el registro
  // de marca y /api/brand/register donde se guarda ese valor.
  let referred_brands_count = 0
  const igUsername = (data.influencer_social_profiles ?? [])
    .find((sp: { platform: string; username: string | null }) => sp.platform === 'instagram')?.username
  if (igUsername && igUsername.trim()) {
    const normalized = igUsername.trim().replace(/^@/, '').toLowerCase()
    const { count } = await admin
      .from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('metadata->>referred_by_instagram', normalized)
    referred_brands_count = count ?? 0
  }

  return NextResponse.json({ data: { ...data, referred_brands_count } })
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
    .select('id, display_name, address, commune, birth_date')
    .eq('user_id', user.id)
    .single()
  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  // Allowed profile fields
  const profileUpdate: Record<string, unknown> = {}
  const allowed = ['display_name', 'bio', 'phone', 'city', 'country', 'address', 'commune', 'birth_date', 'avatar_url', 'categories']
  for (const key of allowed) {
    if (key in body) profileUpdate[key] = body[key]
  }

  // Perfil obligatorio (portal influencer): nombre + Instagram + comuna + dirección +
  // fecha de nacimiento. Se valida el estado FINAL resultante (existente + lo
  // que llega en este PATCH) antes de escribir nada, para que no se pueda
  // vaciar estos campos ni saltarse el requisito llamando el endpoint
  // directo. Ver ProfileCompletionGate.
  // NOTA (2026-07-04): fecha de nacimiento se agregó DESPUÉS de que 1432
  // influencers ya tenían acceso al portal sin este dato. Por decisión de Pri,
  // solo se exige al GUARDAR el perfil (acá), no se agregó a
  // isInfluencerProfileComplete() en (influencer)/layout.tsx — así no se
  // bloquea la navegación de cuentas existentes, solo se pide cuando editan.
  const finalAddress = 'address' in profileUpdate ? String(profileUpdate.address ?? '').trim() : String(influencer.address ?? '').trim()
  const finalCommune = 'commune' in profileUpdate ? String(profileUpdate.commune ?? '').trim() : String(influencer.commune ?? '').trim()
  const finalBirthDate = 'birth_date' in profileUpdate ? String(profileUpdate.birth_date ?? '').trim() : String(influencer.birth_date ?? '').trim()
  const finalDisplayName = 'display_name' in profileUpdate ? String(profileUpdate.display_name ?? '').trim() : String(influencer.display_name ?? '').trim()

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
  if (!finalDisplayName) missing.push('nombre')
  if (!finalAddress) missing.push('dirección')
  if (!finalCommune) missing.push('comuna')
  if (!finalBirthDate) missing.push('fecha de nacimiento')
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
      address, commune, birth_date, categories, tags, is_verified,
      influencer_social_profiles (id, platform, username, followers, engagement_rate, profile_url)
    `)
    .eq('id', influencer.id)
    .single()

  return NextResponse.json({ data: updated })
}
4EӀ