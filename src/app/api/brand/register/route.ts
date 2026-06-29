import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/brand/register
// Llamado en el primer login de una marca recién registrada.
// Crea el registro en 'brands' si no existe y vincula el user_id.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Si ya existe una brands row para este user, retornar sin crear
  const { data: existing } = await admin
    .from('brands')
    .select('id, name')
    .eq('user_id', user.id)
    .single()

  if (existing) return NextResponse.json({ data: existing, created: false })

  // Obtener org_id de SCENCE (la organización principal)
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!org) return NextResponse.json({ error: 'Organización no encontrada' }, { status: 500 })

  const brandName    = user.user_metadata?.brand_name    ?? user.email ?? 'Mi Marca'
  const contactName  = user.user_metadata?.full_name     ?? null
  const contactEmail = user.email ?? null

  const { data: brand, error } = await admin
    .from('brands')
    .insert({
      organization_id: org.id,
      user_id:         user.id,
      name:            brandName,
      contact_name:    contactName,
      contact_email:   contactEmail,
      created_by:      user.id,
    })
    .select('id, name')
    .single()

  if (error) {
    console.error('[POST /api/brand/register]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: brand, created: true })
}
