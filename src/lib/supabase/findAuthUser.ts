import type { SupabaseClient, User } from '@supabase/supabase-js'

// Busca un usuario de Auth por email recorriendo TODAS las páginas de
// admin.auth.admin.listUsers(). listUsers() sin paginar solo trae la primera
// página (50 usuarios; con perPage fijo, solo esa cantidad): con miles de
// usuarios, un usuario existente "no aparece", se intenta createUser y falla
// con "A user with this email address has already been registered".
//
// Si la API de Auth falla, LANZA el error (no devuelve null): null significa
// "no existe", y el caller crearía un usuario duplicado sobre un fallo.
export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase()
  if (!target) return null
  const perPage = 1000
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    const match = users.find(u => u.email?.toLowerCase() === target)
    if (match) return match
    if (users.length < perPage) return null
  }
}
