import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { formText, getInfluencer, notifyBrandReferral, OWNED_BRAND_BUCKET, uploadOwnedBrandLogo } from '@/lib/influencer-owned-brands'
import { normalizeInstagramHandle } from '@/lib/brands/instagram'
import { exactIlikePattern } from '@/lib/email-match'
import { authorizeBrandRegistration, registerBrandAtomic } from '@/lib/supabase/registerBrand'
import { registrationDeniedMessage, registrationKey } from '@/lib/brand-registration-policy'

export async function GET() {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(); const influencer = await getInfluencer(user, admin)
  if (!influencer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await admin.from('brands').select('id, organization_id, name, industry, status, contact_name, contact_email, contact_phone, website, instagram, notes, logo_url, logo_path, created_at').eq('referred_by_influencer_id', influencer.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(); const influencer = await getInfluencer(user, admin)
  if (!influencer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Cuenta verificada y activa (misma política que POST /api/brand/brands).
  const decision = await authorizeBrandRegistration(admin, user)
  if (!decision.allowed) return NextResponse.json({ error: registrationDeniedMessage(decision.reason) }, { status: 403 })
  const form = await request.formData(); const name = formText(form, 'name'); const contactName = formText(form, 'contact_name'); const contactEmail = formText(form, 'contact_email')?.toLowerCase() ?? null
  if (!name) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  if (!contactName) return NextResponse.json({ error: 'El nombre del contacto es requerido' }, { status: 422 })
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return NextResponse.json({ error: 'Email de contacto inválido' }, { status: 422 })
  const instagram = normalizeInstagramHandle(formText(form, 'instagram'))
  if (formText(form, 'instagram') && !instagram) return NextResponse.json({ error: 'Instagram inválido' }, { status: 422 })
  const { data: duplicate } = instagram
    ? await admin.from('brands').select('id, name').eq('instagram_handle_normalized', instagram).limit(1).maybeSingle()
    : await (() => { const namePattern = exactIlikePattern(name); const query = admin.from('brands').select('id, name'); return (namePattern ? query.ilike('name', namePattern) : query.eq('name', name)).limit(1).maybeSingle() })()
  if (duplicate) return NextResponse.json({ error: `La marca ${duplicate.name} ya existe en Scence` }, { status: 409 })

  let logo: { path: string; url: string } | null = null; const file = form.get('logo')
  try { if (file instanceof File && file.size) logo = await uploadOwnedBrandLogo(admin, user.id, file) } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 422 }) }
  const brandFields = { referred_by_influencer_id: influencer.id, name, industry: formText(form, 'category'), contact_name: contactName, contact_email: contactEmail, contact_phone: formText(form, 'contact_phone'), website: formText(form, 'website'), instagram, instagram_handle_normalized: instagram, notes: formText(form, 'notes'), logo_url: logo?.url ?? null, logo_path: logo?.path ?? null, metadata: { source: 'influencer_referral', referrer_user_id: user.id } }
  // Organización + marca en una sola transacción e idempotente: un reintento o dos envíos simultáneos no duplican ni dejan organizaciones huérfanas.
  const registered = await registerBrandAtomic(admin, { brand: brandFields, org: { logo_url: logo?.url ?? null, country: 'CL' }, registeredBy: user.id, key: registrationKey(user.id, brandFields) })
  if (!registered.ok || registered.outcome === 'conflict') {
    if (logo) await admin.storage.from(OWNED_BRAND_BUCKET).remove([logo.path])
    if (registered.ok) return NextResponse.json({ error: 'Esta marca ya existe en Scence' }, { status: 409 })
    console.error('[POST /api/influencer/owned-brands]', registered.error)
    return NextResponse.json({ error: 'No se pudo registrar la marca' }, { status: 500 })
  }
  const { data, error } = await admin.from('brands').select().eq('id', registered.brandId).single()
  if (error || !data) return NextResponse.json({ error: 'No se pudo leer la marca registrada' }, { status: 500 })
  if (registered.outcome === 'replayed') {
    // Reintento de la misma solicitud: el logo recién subido sobra y no se vuelve a avisar.
    if (logo && data.logo_path !== logo.path) await admin.storage.from(OWNED_BRAND_BUCKET).remove([logo.path])
    return NextResponse.json({ data }, { status: 200 })
  }
  waitUntil(notifyBrandReferral({ brandId: data.id, brandName: name, contactName, contactEmail, influencerName: influencer.display_name ?? influencer.email ?? 'Influencer', influencerEmail: influencer.email }).catch(error => console.error('[brand referral email]', error)))
  return NextResponse.json({ data }, { status: 201 })
}
