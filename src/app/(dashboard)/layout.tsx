import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureOrg, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { Sidebar } from '@/components/layout/Sidebar'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Defensa en servidor: el middleware sólo conoce el JWT. Cuentas antiguas
  // pueden tener is_brand ausente o desactualizado; la membresía real de
  // brands/brand_members es la que decide si puede entrar a Admin.
  if (await resolveBrandAccess(user.id)) redirect('/brand-dash')

  // Auto-provision org on first login (no-op if org already exists)
  await ensureOrg(user)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
