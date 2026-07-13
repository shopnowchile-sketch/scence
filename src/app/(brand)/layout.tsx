'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import { BrandSidebar } from './_components/BrandSidebar'
// Reutilizado del portal Influencer (mismo componente, sin cambios) — pedido
// de Pri 2026-07-13: profiles.last_seen_at solo se actualizaba vía heartbeat
// en Influencer; Marca no tenía ningún mecanismo, así que "última conexión"
// de marca nunca reflejaba actividad real dentro del portal. Sin props, sin
// dependencias de datos de influencer — hace POST a /api/presence/heartbeat
// con el usuario de la sesión (auth.getUser()), válido para cualquier rol.
import { PresenceHeartbeat } from '../(influencer)/_components/PresenceHeartbeat'

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  const didRegister = useRef(false)
  // Instagram obligatorio en el portal marca (mismo criterio que el gate del
  // portal influencer: se valida server-side en PATCH /api/brand/me, esto es
  // solo la experiencia de navegación). null = aún cargando.
  const [instagramComplete, setInstagramComplete] = useState<boolean | null>(null)
  // Estado de aprobación admin de la marca. null = aún cargando/desconocido
  // (no bloquear mientras carga, igual que instagramComplete).
  const [brandStatus, setBrandStatus] = useState<string | null>(null)
  const pathname = usePathname()
  // NOTA (build fix): NO usar useSearchParams() acá. Este layout envuelve
  // TODAS las rutas /brand-*, y useSearchParams() sin un boundary Suspense
  // propio hace bailout de generación estática para cada página hija —
  // rompió el build entero del portal marca (15 páginas fallando en
  // "next build"). usePathname() no tiene ese problema. El refetch en cada
  // cambio de pathname ya alcanza para resolver el bug real (el aviso de
  // Instagram pegado): al guardar y navegar a cualquier otra página, se
  // vuelve a chequear /api/brand/me fresco.
  const router = useRouter()
  // Vista reutilizada del admin (Configuración > Organización), no una
  // vista paralela reducida — ver BrandOrgForm.
  // FIX: antes solo eximía '/brand-settings/organization' exacto. Al tocar
  // cualquier otro tab de Configuración (Lugares, Usuarios, Plan,
  // Notificaciones) el pathname cambiaba, el gate lo detectaba como "otra
  // página" y la rebotaba de vuelta a Organización — o sea, no podía ver
  // ningún otro tab mientras el Instagram siguiera incompleto (reportado:
  // "no me aparece la pestaña de los lugares"). Ahora se exime toda la
  // sección de Configuración, no solo esa sub-ruta.
  const isProfilePage = pathname.startsWith('/brand-settings')

  useEffect(() => {
    let cancelled = false

    async function fetchBrandProfile() {
      try {
        const res = await fetch('/api/brand/me', {
          cache: 'no-store',
        })

        if (!res.ok) {
          console.error('[BrandLayout] brand/me failed:', res.status)

          if (!cancelled) {
            setBrandStatus('error')
            setInstagramComplete(false)
          }
          return
        }

        const json = await res.json()

        if (cancelled) return

        setBrandStatus(json?.data?.status ?? 'error')
        setInstagramComplete(
          Boolean(
            json?.data?.instagram &&
            String(json.data.instagram).trim(),
          ),
        )
      } catch (error) {
        console.error('[BrandLayout] brand/me network error:', error)

        if (!cancelled) {
          setBrandStatus('error')
          setInstagramComplete(false)
        }
      }
    }

    async function bootstrapBrand() {
      if (didRegister.current) {
        await fetchBrandProfile()
        return
      }

      didRegister.current = true
      setBrandStatus(null)
      setInstagramComplete(null)

      let registered = false

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetch('/api/brand/register', {
            method: 'POST',
            cache: 'no-store',
          })

          if (res.ok) {
            registered = true
            break
          }

          console.error('[BrandLayout] brand/register failed:', res.status)
        } catch (error) {
          console.error('[BrandLayout] brand/register network error:', error)
        }
      }

      if (cancelled) return

      if (!registered) {
        setBrandStatus('error')
        setInstagramComplete(false)

        toast.error(
          'No pudimos preparar tu cuenta de marca. Reintenta o contáctanos si persiste.',
          {
            action: {
              label: 'Reintentar',
              onClick: () => {
                didRegister.current = false
                void bootstrapBrand()
              },
            },
          },
        )
        return
      }

      await fetchBrandProfile()
    }

    void bootstrapBrand()

    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    if (instagramComplete === false && !isProfilePage) router.replace('/brand-settings/organization?complete=1')
  }, [instagramComplete, isProfilePage, router])

  // Marca autorregistrada sin aprobar todavía por un admin → sin acceso al
  // portal operativo (regla de producto explícita). Prioridad sobre el gate
  // de Instagram: si no está aprobada, ni siquiera importa si falta Instagram.
  const approved = brandStatus === 'approved'
  const loadingStatus = instagramComplete === null || brandStatus === null
  const pendingApproval = !loadingStatus && !approved
  const blocked = loadingStatus || (approved && instagramComplete === false && !isProfilePage)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <PresenceHeartbeat />
      <BrandSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {pendingApproval ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="max-w-sm text-center">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <Clock className="h-7 w-7 text-amber-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 mb-2">
                  {brandStatus === 'pending_approval'
                    ? 'Tu cuenta está en revisión'
                    : brandStatus === 'rejected'
                      ? 'Cuenta no aprobada'
                      : brandStatus === 'suspended'
                        ? 'Cuenta suspendida'
                        : 'No pudimos cargar tu cuenta'}
                </h2>
                <p className="text-sm text-gray-500">
                  {brandStatus === 'pending_approval'
                    ? 'Un administrador de SCENCE debe aprobar tu cuenta antes de que puedas acceder al portal. Te avisaremos por email apenas esté lista.'
                    : brandStatus === 'rejected'
                      ? 'Tu solicitud de marca no fue aprobada. Si crees que es un error, contáctanos.'
                      : brandStatus === 'suspended'
                        ? 'Tu cuenta está suspendida. Contáctanos para revisar el acceso.'
                        : 'No pudimos preparar tu cuenta. Usa el botón de reintento o contáctanos.'}
                </p>
              </div>
            </div>
          ) : blocked ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : children}
        </div>
      </main>
    </div>
  )
}
