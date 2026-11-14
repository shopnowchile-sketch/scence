import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/locations'

// Compartir un place entre marcas = una fila en location_brand_shares. Solo permite USAR
// el lugar en campañas de la marca receptora; no da acceso a campañas, contactos ni datos
// de la marca dueña. Solo el propietario (brand_id) o Admin comparten o retiran.
// `granted_by` (sin FK por la divergencia profiles.id/user_id) lo fija SIEMPRE el servidor
// con la sesión: el body nunca lo controla.

/** ¿Puede esta marca asociar el lugar a una campaña? Propietaria o receptora activa, y no privado ajeno. */
export async function brandCanUseLocation(admin: SupabaseClient, locationId: string, brandId: string): Promise<boolean> {
  const { data: place } = await admin.from('locations')
    .select('id, brand_id, is_private, is_active').eq('id', locationId).eq('level', 'place').maybeSingle()
  if (!place) return false
  if (place.brand_id === brandId) return true
  if (!place.is_active || place.is_private) return false
  const { data: share } = await admin.from('location_brand_shares')
    .select('id').eq('location_id', locationId).eq('brand_id', brandId).maybeSingle()
  return Boolean(share)
}

/** Lugares compartidos CON la marca (para selectores; solo lectura). */
export async function sharedPlacesForBrand(admin: SupabaseClient, brandId: string, columns: string) {
  const { data: shares } = await admin.from('location_brand_shares').select('location_id').eq('brand_id', brandId)
  const ids = (shares ?? []).map(s => s.location_id as string)
  if (!ids.length) return []
  const { data } = await admin.from('locations').select(columns)
    .in('id', ids).eq('level', 'place').eq('is_active', true).eq('is_private', false)
  return (data ?? []) as unknown as Array<Record<string, unknown>>
}

type Actor = { userId: string; ownerBrandId: string | null } // ownerBrandId null = Admin de plataforma

export async function listShares(admin: SupabaseClient, locationId: string, actor: Actor) {
  if (!isUuid(locationId)) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  const place = await ownedPlace(admin, locationId, actor)
  if (!place) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  const { data, error } = await admin.from('location_brand_shares')
    .select('id, brand_id, created_at, brands(name)').eq('location_id', locationId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function addShare(admin: SupabaseClient, locationId: string, targetBrandId: unknown, actor: Actor) {
  if (!isUuid(locationId)) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  if (!isUuid(targetBrandId)) return NextResponse.json({ error: 'brand_id inválido' }, { status: 400 })
  const place = await ownedPlace(admin, locationId, actor)
  if (!place) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  if (place.is_private) return NextResponse.json({ error: 'Un lugar privado no se puede compartir.' }, { status: 422 })
  if (!place.is_active) return NextResponse.json({ error: 'El lugar está desactivado.' }, { status: 422 })
  if (place.brand_id === targetBrandId) return NextResponse.json({ error: 'La marca ya es propietaria del lugar.' }, { status: 422 })
  // Solo marcas existentes y aprobadas; inexistente o no aprobada responden igual.
  const { data: target } = await admin.from('brands').select('id, status').eq('id', targetBrandId).maybeSingle()
  if (!target || target.status !== 'approved') return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 })
  const { data, error } = await admin.from('location_brand_shares')
    .insert({ location_id: locationId, brand_id: targetBrandId, granted_by: actor.userId })
    .select('id, brand_id, created_at').single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'Ya está compartido con esa marca.' : error.message }, { status: error.code === '23505' ? 409 : 500 })
  return NextResponse.json({ data }, { status: 201 })
}

export async function removeShare(admin: SupabaseClient, locationId: string, targetBrandId: unknown, actor: Actor) {
  if (!isUuid(locationId) || !isUuid(targetBrandId)) return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 })
  const place = await ownedPlace(admin, locationId, actor)
  if (!place) return NextResponse.json({ error: 'Ubicación no encontrada' }, { status: 404 })
  // Retirar no toca campañas ya asociadas: conservan su historial (campaign_locations).
  const { error } = await admin.from('location_brand_shares').delete().eq('location_id', locationId).eq('brand_id', targetBrandId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function ownedPlace(admin: SupabaseClient, locationId: string, actor: Actor) {
  let q = admin.from('locations').select('id, brand_id, is_private, is_active').eq('id', locationId).eq('level', 'place')
  if (actor.ownerBrandId) q = q.eq('brand_id', actor.ownerBrandId)
  const { data } = await q.maybeSingle()
  return data
}
