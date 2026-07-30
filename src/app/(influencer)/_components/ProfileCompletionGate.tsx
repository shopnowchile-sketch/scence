'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Solo se aplica a cuentas creadas con el registro nuevo. Los perfiles legacy
// permanecen navegables para no bloquear a la base histórica por datos que no
// se les pidieron al registrarse.
export function ProfileCompletionGate({ children, complete, required }: {
  complete: boolean
  required: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (required && !complete && pathname !== '/inf-profile') {
      router.replace('/inf-profile')
    }
  }, [complete, pathname, required, router])

  if (required && !complete && pathname !== '/inf-profile') return null
  return <>{children}</>
}
