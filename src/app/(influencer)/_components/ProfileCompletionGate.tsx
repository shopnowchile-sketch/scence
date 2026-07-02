'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Perfil obligatorio en el portal influencer: Instagram + comuna + dirección.
// `complete` se calcula server-side en layout.tsx (misma tabla `influencers`
// que ya usa /api/influencer/me) y se pasa como prop. Si falta algo, se
// redirige a /inf-profile, que ya fuerza el modo edición cuando el perfil
// está incompleto (ver isProfileComplete en inf-profile/page.tsx). El PATCH
// /api/influencer/me valida lo mismo server-side, así que esto es solo la
// experiencia de navegación, no la única barrera.
export function ProfileCompletionGate({ complete, children }: { complete: boolean; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isProfilePage = pathname === '/inf-profile'

  useEffect(() => {
    if (!complete && !isProfilePage) router.replace('/inf-profile?complete=1')
  }, [complete, isProfilePage, router])

  if (!complete && !isProfilePage) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
