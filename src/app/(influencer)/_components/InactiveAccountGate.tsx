'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LockKeyhole, LifeBuoy } from 'lucide-react'

export function InactiveAccountGate({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()

  if (!active && pathname !== '/inf-support') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-xl rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Tu cuenta está inactiva</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">
            Tu acceso a campañas está temporalmente desactivado.
            Para solicitar la activación de tu cuenta, contacta a Soporte SCENCE.
          </p>
          <Link
            href="/inf-support"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
          >
            <LifeBuoy className="h-4 w-4" />
            Contactar a Soporte
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
