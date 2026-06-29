'use client'

import { useEffect, useRef } from 'react'
import { BrandSidebar } from './_components/BrandSidebar'

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  const didSetup = useRef(false)

  // Auto-crear brands record la primera vez que una marca self-registrada hace login
  useEffect(() => {
    if (didSetup.current) return
    didSetup.current = true
    fetch('/api/brand/register', { method: 'POST' }).catch(() => null)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <BrandSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
