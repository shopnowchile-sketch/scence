import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { INFLUENCER_PRO_TERMS, INFLUENCER_PRO_TERMS_SNAPSHOT } from '@/lib/influencer-pro-terms'

async function authenticatedInfluencer() {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  const admin = createAdminClient()
  const { data: influencer } = await admin.from('influencers').select('id').eq('user_id', user.id).maybeSingle()
  return influencer ? { admin, influencer, user } : null
}

export async function GET() {
  const auth = await authenticatedInfluencer()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await auth.admin.from('influencer_terms_acceptances').select('id, document_key, document_title, document_version, content_snapshot, status, accepted_at, created_at').eq('influencer_id', auth.influencer.id).order('accepted_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'No se pudo consultar tus documentos.' }, { status: 500 })
  return NextResponse.json({ data: data ?? [], current_version: INFLUENCER_PRO_TERMS.version })
}

export async function POST(request: NextRequest) {
  const auth = await authenticatedInfluencer()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { accepted?: boolean; document_key?: string; version?: string } | null
  if (body?.accepted !== true || body.document_key !== INFLUENCER_PRO_TERMS.key || body.version !== INFLUENCER_PRO_TERMS.version) return NextResponse.json({ error: 'Debes aceptar la versión vigente de los términos.' }, { status: 422 })
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null
  const row = { influencer_id: auth.influencer.id, user_id: auth.user.id, document_key: INFLUENCER_PRO_TERMS.key, document_title: INFLUENCER_PRO_TERMS.title, document_version: INFLUENCER_PRO_TERMS.version, content_snapshot: INFLUENCER_PRO_TERMS_SNAPSHOT, status: 'accepted', accepted_at: new Date().toISOString(), acceptance_ip: ip, user_agent: request.headers.get('user-agent') }
  const { data, error } = await auth.admin.from('influencer_terms_acceptances').upsert(row, { onConflict: 'influencer_id,document_key,document_version', ignoreDuplicates: true }).select('id, document_version, status, accepted_at').maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo registrar la aceptación.' }, { status: 500 })
  if (data) return NextResponse.json({ data })
  const { data: existing } = await auth.admin.from('influencer_terms_acceptances').select('id, document_version, status, accepted_at').eq('influencer_id', auth.influencer.id).eq('document_key', INFLUENCER_PRO_TERMS.key).eq('document_version', INFLUENCER_PRO_TERMS.version).single()
  return NextResponse.json({ data: existing })
}
