'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import Link from 'next/link'
import { isBrandCampaignPath, pendingBrandPathAllowed } from '@/lib/brand-status-access'
import { BrandSidebar } from './_components/BrandSidebar'
import { BrandOnboarding } from '@/components/brand/BrandOnboarding'
import { AgencyBrandSwitcher } from '@/components/plan/AgencyBrandSwitcher'
import { AgencyCheckoutGate } from '@/components/plan/AgencyCheckoutGate'
// Reutilizado del portal Influencer (mismo componente, sin cambios) — pedido
// de Pri 2026-07-13: profiles.last_seen_at solo se actualizaba vía heartbeat
// en Influencer; Marca no tenía ningún mecanismo, así que "última conexión"
// de marca nunca reflejaba actividad real dentro del portal. Sin props, sin
// dependencias de datos de influencer — hace POST a /api/presence/heartbeat
// con el usuario de la sesión (auth.getUser()), válido para cualquier rol.
import { PresenceHeartbeat } from '../(influencer)/_components/PresenceHeartbeat'

function BrandSectionVisit({ pathname }: { pathname: string }) {
  useEffect(() => {
    void fetch('/api/brand/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])
  return null
}

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  const didRegister = useRef(false)
  // Instagram obligatorio en el portal marca (mismo criterio que el gate del
  // portal influencer: se valida server-side en PATCH /api/brand/me, esto es
  // solo la experiencia de navegación). null = aún cargando.
  const [instagramComplete, setInstagramComplete] = useState<boolean | null>(null)
  // Estado de aprobación admin de la marca. null = aún cargando/desconocido
  // (no bloquear mientras carga, igual que instagramComplete).
  const [ndaSigned, setNdaSigned] = useState(false)
  const [brandStatus, setBrandStatus] = useState<string | null>(null)
  const [brandName, setBrandName] = useState('')
  const [brandPlan, setBrandPlan] = useState<string | null>(null)
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
  // Una marca nueva puede revisar y contratar un plan aun antes de estar
  // aprobada. Las demás secciones operativas siguen bloqueadas hasta que el
  // pago confirme la activación de su cuenta.
  const isPlanPage = pathname.startsWith('/brand-settings/plan')
  // Marca pendiente: puede completar perfil, consultar facturación y completar documentos (brand-status-access.ts).
  const pendingPageAllowed = brandStatus === 'pending_approval' && (pendingBrandPathAllowed(pathname) || isBrandCampaignPath(pathname))
  const ndaLocked = brandStatus === 'approved' && !ndaSigned
  const ndaPageAllowed = ['/brand-documents', '/brand-settings/organization', '/brand-settings/profile'].includes(pathname)

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
            setBrandName('')
            setBrandStatus('error')
            setBrandPlan(null)
            setInstagramComplete(false)
          }
          return
        }

        const json = await res.json()

        if (cancelled) return

        setBrandName(typeof json?.data?.name === 'string' ? json.data.name.trim() : '')
        setNdaSigned(json?.data?.nda_signed === true)
        setBrandStatus(json?.data?.status ?? 'error')
        setBrandPlan(typeof json?.data?.org_plan === 'string' ? json.data.org_plan : null)
        setInstagramComplete(
          Boolean(
            json?.data?.instagram &&
            String(json.data.instagram).trim(),
          ),
        )
      } catch (error) {
        console.error('[BrandLayout] brand/me network error:', error)

        if (!cancelled) {
          setBrandName('')
          setBrandStatus('error')
          setBrandPlan(null)
          setInstagramComplete(false)
        }
      }
    }

    async function bootstrapBrand() {
      if (didRegister.current) {
        await fetchBrandProfile()
        return
      }

      setBrandStatus(null)
      setBrandPlan(null)
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
        setBrandPlan(null)
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

      didRegister.current = true
      await fetchBrandProfile()
    }

    void bootstrapBrand()

    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    if (instagramComplete === false && !isProfilePage && !ndaLocked && pathname !== '/brand-documents') router.replace('/brand-settings/organization?complete=1')
  }, [instagramComplete, isProfilePage, ndaLocked, pathname, router])

  // Sin barrera de pago al entrar (decisión 2026-11-03): una marca aprobada navega el portal, crea y edita
  // campañas y guarda borradores sin suscripción. La mensualidad se pide únicamente al «Enviar a aprobación»
  // (PATCH /api/brand/campaigns/[id] → 402 → checkout PayPal). Solo la suspensión comercial limita el acceso.

  // Marca suspendida: no se redirige a Planes ni se habla de «período gratuito». Se muestra el aviso de suspensión
  // (abajo); su plan y suscripción no cambian. Planes sigue accesible solo para resolver obligaciones de pago.

  // Marca autorregistrada sin aprobar todavía por un admin → sin acceso al
  // portal operativo (regla de producto explícita). Prioridad sobre el gate
  // de Instagram: si no está aprobada, ni siquiera importa si falta Instagram.
  const approved = brandStatus === 'approved'
  const loadingStatus = instagramComplete === null || brandStatus === null
  const pendingApproval = !loadingStatus && !approved
  const blocked = loadingStatus
    || (approved && instagramComplete === false && !isProfilePage && pathname !== '/brand-documents' && !ndaLocked)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <PresenceHeartbeat />
      <BrandSidebar brandName={brandName} plan={brandPlan} ndaLocked={ndaLocked} />
      <AgencyBrandSwitcher />
      {!ndaLocked && <AgencyCheckoutGate />}
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {ndaLocked && !ndaPageAllowed ? (
            <div className="card mx-auto max-w-md p-6">
              <h2 className="font-bold text-gray-900">Firma el NDA para continuar</h2>
              <p className="mt-2 text-sm text-gray-600">Completa los datos de la empresa y del representante legal. Luego el representante debe firmar en Documentos.</p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold text-violet-700">
                <Link href="/brand-settings/organization">Completar datos</Link>
                <Link href="/brand-documents">Ir a Documentos</Link>
              </div>
            </div>
          ) : pendingApproval && !isPlanPage && !pendingPageAllowed ? (
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
                        ? 'Marca suspendida'
                        : 'No pudimos cargar tu cuenta'}
                </h2>
                <p className="text-sm text-gray-500">
                  {brandStatus === 'pending_approval'
                    ? 'Ya puedes preparar un borrador de campaña. Antes de enviarlo a revisión, completa el pago si corresponde y firma el NDA.'
                    : brandStatus === 'rejected'
                      ? 'Tu solicitud de marca no fue aprobada. Si crees que es un error, contáctanos.'
                      : brandStatus === 'suspended'
                        ? 'Esta marca se encuentra suspendida. Contacta a soporte para solicitar una revisión.'
                        : 'No pudimos preparar tu cuenta. Usa el botón de reintento o contáctanos.'}
                </p>
              </div>
            </div>
          ) : blocked ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : <>
            <BrandSectionVisit pathname={pathname} />
            {children}
            {!ndaLocked && <BrandOnboarding />}
          </>}
        </div>
      </main>
    </div>
  )
}
