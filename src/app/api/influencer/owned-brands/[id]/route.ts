import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { formText, getInfluencer, OWNED_BRAND_BUCKET, uploadOwnedBrandLogo } from '@/lib/influencer-owned-brands'

type Params = { params: { id: string } }

async function context(id: string) {
  const supabase = createServerClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 401 as const, user: null, admin: null, brand: null }
  const admin = createAdminClient(); const influencer = await getInfluencer(user, admin)
  if (!influencer) return { status: 403 as const, user: null, admin: null, brand: null }
  const { data: brand } = await admin.from('brands').select('*').eq('id', id).eq('referred_by_influencer_id', influencer.id).maybeSingle()
  return { status: brand ? 200 as const : 404 as const, user, admin, brand }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await context(params.id)
  if (!ctx.user || !ctx.admin || !ctx.brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: ctx.status })
  if (ctx.brand.status !== 'pending_approval') return NextResponse.json({ error: 'Una marca revisada solo puede ser editada por Scence' }, { status: 409 })
  const form = await request.formData(); const name = formText(form, 'name'); const contactName = formText(form, 'contact_name'); const contactEmail = formText(form, 'contact_email')?.toLowerCase() ?? null
  if (!name) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 422 })
  if (!contactName) return NextResponse.json({ error: 'El nombre del contacto es requerido' }, { status: 422 })
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return NextResponse.json({ error: 'Email de contacto inválido' }, { status: 422 })
  let logo: { path: string; url: string } | null = null; const file = form.get('logo')
  try { if (file instanceof File && file.size) logo = await uploadOwnedBrandLogo(ctx.admin, ctx.user.id, file) } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 422 }) }
  const { data, error } = await ctx.admin.from('brands').update({ name, industry: formText(form, 'category'), contact_name: contactName, contact_email: contactEmail, contact_phone: formText(form, 'contact_phone'), website: formText(form, 'website'), instagram: formText(form, 'instagram'), notes: formText(form, 'notes'), ...(logo ? { logo_url: logo.url, logo_path: logo.path } : {}), updated_at: new Date().toISOString() }).eq('id', params.id).eq('referred_by_influencer_id', ctx.brand.referred_by_influencer_id).select().single()
  if (error) { if (logo) await ctx.admin.storage.from(OWNED_BRAND_BUCKET).remove([logo.path]); return NextResponse.json({ error: error.message }, { status: 500 }) }
  await ctx.admin.from('organizations').update({ name, ...(logo ? { logo_url: logo.url } : {}) }).eq('id', ctx.brand.organization_id)
  if (logo && ctx.brand.logo_path) await ctx.admin.storage.from(OWNED_BRAND_BUCKET).remove([ctx.brand.logo_path])
  return NextResponse.json({ data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await context(params.id)
  if (!ctx.user || !ctx.admin || !ctx.brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: ctx.status })
  if (ctx.brand.status !== 'pending_approval') return NextResponse.json({ error: 'Una marca revisada no puede eliminarse desde este portal' }, { status: 409 })
  const { error } = await ctx.admin.from('organizations').delete().eq('id', ctx.brand.organization_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (ctx.brand.logo_path) await ctx.admin.storage.from(OWNED_BRAND_BUCKET).remove([ctx.brand.logo_path])
  return NextResponse.json({ ok: true })
}
