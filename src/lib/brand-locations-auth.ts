import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess, type BrandAccess } from '@/lib/supabase/ensureOrg'

/**
 * Autorización única de /api/brand/locations*: solo usuarios de MARCA, con el
 * permiso pedido. El alcance (brand_id) sale de la sesión, nunca del request.
 * (El admin de plataforma administra todo desde /api/locations.)
 */
export async function authorizeBrandLocations(
  permission: 'location.read' | 'location.manage',
): Promise<{ res: NextResponse } | { userId: string; admin: SupabaseClient; access: BrandAccess }> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await resolveBrandAccess(user.id)
  if (!access) return { res: NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 }) }
  if (!hasBrandPermission(access, permission)) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId: user.id, admin: createAdminClient(), access }
}
