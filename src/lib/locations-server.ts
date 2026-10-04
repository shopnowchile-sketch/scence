import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

/**
 * Autorización única de /api/locations (Fase 1): solo admin de plataforma.
 * `locations` incluye domicilios privados de influencers y lugares de marcas.
 */
export async function authorizeLocationsAdmin(): Promise<
  { res: NextResponse } | { user: User; admin: SupabaseClient }
> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) {
    return { res: NextResponse.json({ error: 'Solo administradores de SCENCE pueden gestionar ubicaciones' }, { status: 403 }) }
  }
  return { user, admin }
}
