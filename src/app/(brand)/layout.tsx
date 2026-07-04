'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BrandSidebar } from './_components/BrandSidebar'

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  const didRegister = useRef(false)
  // Instagram obligatorio en el portal marca (mismo criterio que el gate del
  // portal influencer: se valida server-side en PATCH /api/brand/me, esto es
  // solo la experiencia de navegación). null = aún cargando.
  const [instagramComplete, setInstagramComplete] = useState<boolean | null>(null)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  // Vista reutilizada del admin (Configuración > Organización), no una
  // vista paralela reducida — ver BrandOrgForm.
  const isProfilePage = pathname === '/brand-settings/organization'

  useEffect(() => {
    if (didRegister.current) return
    didRegister.current = true
    // Auto-crear brands record la primera vez que una marca self-registrada hace
    // login (la fila puede no existir todavía en el primer login).
    fetch('/api/brand/register', { method: 'POST' }).catch(() => null)
  }, [])

  useEffect(() => {
    // Se re-chequea en cada navegación (no solo una vez al montar) para que,
    // al guardar el Instagram en /brand-settings/organization y navegar a
    // cualquier otra página, el bloqueo se levante sin quedar pegado en el
    // estado "false" cacheado del primer fetch (bug reportado: el aviso
    // seguía apareciendo después de completar el Instagram).
    fetch('/api/brand/me')
      .then(r => r.ok ? r.json() : null)
      .then(j => setInstagramComplete(!!(j?.data?.instagram && String(j.data.instagram).trim())))
      .catch(() => setInstagramComplete(true)) // si falla la carga, no bloquear
  }, [pathname, searchParams])

  useEffect(() => {
    if (instagramComplete === false && !isProfilePage) router.replace('/brand-settings/organization?complete=1')
  }, [instagramComplete, isProfilePage, router])

  const blocked = instagramComplete === null || (instagramComplete === false && !isProfilePage)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <BrandSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {blocked ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : children}
        </div>
      </main>
    </div>
  )
}
