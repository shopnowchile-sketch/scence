import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureOrg } from '@/lib/supabase/ensureOrg'
import { InfluencerSidebar } from './_components/InfluencerSidebar'

export const metadata: Metadata = {
  title: { default: 'Mi Portal — Scence', template: '%s | Scence' },
}

export const dynamic = 'force-dynamic'

export default async function InfluencerLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await ensureOrg(user)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <InfluencerSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1200px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
