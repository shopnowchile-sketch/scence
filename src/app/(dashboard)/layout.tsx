import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { defaultPortalPath } from '@/lib/portal-access'
import { resolvePortalAccess } from '@/lib/portal-access-server'
import { Sidebar } from '@/components/layout/Sidebar'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Admin no es el fallback de una identidad dual. El acceso se decide por
  // memberships e influencer.user_id; auth metadata nunca concede un portal.
  const access = await resolvePortalAccess(user.id)
  if (!access.isPlatformAdmin) redirect(defaultPortalPath(access))

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
