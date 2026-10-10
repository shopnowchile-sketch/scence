import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'
import { RequirementsClient } from './RequirementsClient'

export const metadata: Metadata = { title: 'Requerimientos' }
export const dynamic = 'force-dynamic'

export default async function AdminRequirementsPage() {
  // El registro revela rutas y brechas internas: solo administradores de plataforma.
  const { data: { user } } = await createServerClient().auth.getUser()
  if (!user) redirect('/login')
  if (!(await isPlatformAdmin(user.id, createAdminClient()))) redirect('/admin-dash')
  return <RequirementsClient />
}
