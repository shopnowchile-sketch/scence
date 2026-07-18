import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { formText, getInfluencer, notifyBrandReferral, OWNED_BRAND_BUCKET, uploadOwnedBrandLogo } from '@/lib/influencer-owned-brands'

function slug(name: string) {
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'marca'
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

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
  const form = await request.formData(); const name = formText(form, 'name'); const contactName = formText(form, 'contact_name'); const contactEmail = formText(form, 'contact_email')?.toLowerCase() ?? null
  if (!name) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  if (!contactName) return NextResponse.json({ error: 'El nombre del contacto es requerido' }, { status: 422 })
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return NextResponse.json({ error: 'Email de contacto inválido' }, { status: 422 })
  const { data: duplicate } = await admin.from('brands').select('id, name').ilike('name', name).limit(1).maybeSingle()
  if (duplicate) return NextResponse.json({ error: `La marca ${duplicate.name} ya existe en Scence` }, { status: 409 })

  let logo: { path: string; url: string } | null = null; const file = form.get('logo')
  try { if (file instanceof File && file.size) logo = await uploadOwnedBrandLogo(admin, user.id, file) } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 422 }) }
  const { data: organization, error: orgError } = await admin.from('organizations').insert({ name, slug: slug(name), type: 'brand', logo_url: logo?.url ?? null, country: 'CL' }).select('id').single()
  if (orgError) { if (logo) await admin.storage.from(OWNED_BRAND_BUCKET).remove([logo.path]); return NextResponse.json({ error: orgError.message }, { status: 500 }) }
  const { data, error } = await admin.from('brands').insert({ organization_id: organization.id, created_by: user.id, referred_by_influencer_id: influencer.id, name, industry: formText(form, 'category'), contact_name: contactName, contact_email: contactEmail, contact_phone: formText(form, 'contact_phone'), website: formText(form, 'website'), instagram: formText(form, 'instagram'), notes: formText(form, 'notes'), logo_url: logo?.url ?? null, logo_path: logo?.path ?? null, status: 'pending_approval', metadata: { source: 'influencer_referral', referrer_user_id: user.id } }).select().single()
  if (error) { await admin.from('organizations').delete().eq('id', organization.id); if (logo) await admin.storage.from(OWNED_BRAND_BUCKET).remove([logo.path]); return NextResponse.json({ error: error.message }, { status: 500 }) }
  waitUntil(notifyBrandReferral({ brandId: data.id, brandName: name, contactName, contactEmail, influencerName: influencer.display_name ?? influencer.email ?? 'Influencer', influencerEmail: influencer.email }).catch(error => console.error('[brand referral email]', error)))
  return NextResponse.json({ data }, { status: 201 })
}
