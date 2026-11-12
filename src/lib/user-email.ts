import type { SupabaseClient } from '@supabase/supabase-js'

// user_email = auth.users.email: el correo vive solo en Auth, no se copia a ninguna tabla.
// Para listas chicas (equipo de una marca, destinatarios de un aviso) se consulta Auth por usuario.
export async function getUserEmails(admin: SupabaseClient, userIds: string[]): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)))
  const entries = await Promise.all(unique.map(async id => {
    const { data } = await admin.auth.admin.getUserById(id)
    return [id, data?.user?.email?.trim().toLowerCase() ?? null] as const
  }))
  return Object.fromEntries(entries)
}
