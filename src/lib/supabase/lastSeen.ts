import type { createAdminClient } from '@/lib/supabase/server'
import { mapInBatches } from '@/lib/supabase/fetchAllRows'

// Resuelve "última conexión efectiva" para un batch de user_ids.
// profiles.last_seen_at es la fuente PRINCIPAL (heartbeat real del portal —
// activo en Influencer y, desde 2026-07-13, en Marca). auth.users.last_sign_in_at
// es SOLO respaldo para cuando last_seen_at es null (ej. login real pero
// heartbeat nunca se disparó). Pedido explícito de Pri 2026-07-13.
//
// Extraído de /api/influencers/route.ts para reusarlo también en
// /api/dashboard/route.ts (KPI "influencers que ingresaron al portal") sin
// duplicar la lógica de paginado de listUsers() en dos archivos.
export async function resolveLastSeen(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  if (userIds.length === 0) return result

  // En lotes: un `.in()` con miles de UUID excede el largo de URL de PostgREST,
  // la consulta falla en silencio y se perdía el heartbeat real (last_seen_at).
  // Las tandas son independientes: se consultan en paralelo (hasta 4 a la vez) en vez de una tras otra.
  const profileBatches = await mapInBatches(userIds, 200, async batch => {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, last_seen_at')
      .in('id', batch)
    return profiles ?? []
  })
  for (const profiles of profileBatches) {
    for (const p of profiles) {
      result[p.id as string] = (p.last_seen_at as string | null) ?? null
    }
  }

  const pending = new Set(userIds.filter(uid => !result[uid]))
  if (pending.size > 0) {
    let page = 1
    while (pending.size > 0) {
      const { data: usersPage, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error || !usersPage?.users?.length) break
      for (const u of usersPage.users) {
        if (pending.has(u.id)) {
          result[u.id] = u.last_sign_in_at ?? null
          pending.delete(u.id)
        }
      }
      if (usersPage.users.length < 1000) break
      page++
    }
  }

  return result
}
