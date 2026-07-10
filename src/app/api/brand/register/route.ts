import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { ensureOrg } from '@/lib/supabase/ensureOrg'

// POST /api/brand/register
// Llamado en el primer login de una marca recién registrada (y en cada carga
// del layout mientras no exista fila — ver (brand)/layout.tsx). Crea el
// registro en 'brands' si no existe y vincula el user_id. Idempotente: no
// duplica si ya corrió antes, ni si corre dos veces casi en simultáneo.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.user_metadata?.is_brand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // 1) Si ya existe una brands row para este user, retornar sin crear.
  const { data: existing } = await admin
    .from('brands')
    .select('id, name, status')
    .eq('user_id', user.id)
    .single()

  if (existing) return NextResponse.json({ data: existing, created: false })

  const contactEmail = user.email ?? null
  const brandName    = user.user_metadata?.brand_name ?? user.email ?? 'Mi Marca'
  const contactName  = user.user_metadata?.full_name  ?? null

  // 2) Dedup por email (no solo por user_id): si ya existe una fila de marca
  // con este email sin user_id todavía (agregada a mano por admin, o de un
  // intento de registro anterior que falló a mitad de camino), vincularla en
  // vez de crear una fila nueva y duplicada. Mismo patrón que
  // ensureInfluencerRow() usa para influencers.
  if (contactEmail) {
    const { data: orphan } = await admin
      .from('brands')
      .select('id, name, status')
      .is('user_id', null)
      .ilike('contact_email', contactEmail)
      .limit(1)
      .maybeSingle()

    if (orphan) {
      const { error: linkErr } = await admin
        .from('brands')
        .update({ user_id: user.id })
        .eq('id', orphan.id)
      if (linkErr) {
        console.error('[POST /api/brand/register] failed to link orphan row:', linkErr.message)
      } else {
        return NextResponse.json({ data: orphan, created: false, linked: true })
      }
    }
  }

  // 3) Organización propia del tenant — SCENCE es multi-org por marca, cada
  // marca tiene su propia organización (no la org compartida de admin).
  // ensureOrg() reutiliza user_metadata.organization_id si ya existe, o crea
  // una nueva y la deja guardada — mismo mecanismo ya usado en el resto de la
  // app para brand_manager en su primer login.
  const orgId = await ensureOrg(user)
  if (!orgId) return NextResponse.json({ error: 'No se pudo aprovisionar la organización' }, { status: 500 })

  // "¿Quién te invitó?" del formulario de registro — normalizado (sin @, minúsculas,
  // sin espacios) para poder matchearlo después contra el instagram de la influencer.
  // Se guarda en brands.metadata (jsonb existente, sin columna nueva). Ver
  // GET /api/influencer/me (referred_brands_count) para el conteo inverso.
  const rawReferral = user.user_metadata?.referred_by_instagram
  const referredByInstagram = typeof rawReferral === 'string' && rawReferral.trim()
    ? rawReferral.trim().replace(/^@/, '').toLowerCase()
    : null

  const { data: brand, error } = await admin
    .from('brands')
    .insert({
      organization_id: orgId,
      user_id:         user.id,
      name:            brandName,
      contact_name:    contactName,
      contact_email:   contactEmail,
      created_by:      user.id,
      status:          'pending_approval', // explícito — un admin debe aprobar antes de acceso operativo
      metadata:        referredByInstagram ? { referred_by_instagram: referredByInstagram } : null,
    })
    .select('id, name, status')
    .single()

  if (error) {
    // Carrera: dos requests casi simultáneas (doble efecto de React, retry de
    // red) pueden pasar el chequeo `existing` antes de que la otra termine de
    // insertar. brands_user_id_unique es UNIQUE — si choca, la fila ya existe,
    // volver a buscarla en vez de fallar en silencio.
    if (error.code === '23505') {
      const { data: wonByOther } = await admin
        .from('brands')
        .select('id, name, status')
        .eq('user_id', user.id)
        .single()
      if (wonByOther) return NextResponse.json({ data: wonByOther, created: false })
    }
    console.error('[POST /api/brand/register]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: brand, created: true })
}
