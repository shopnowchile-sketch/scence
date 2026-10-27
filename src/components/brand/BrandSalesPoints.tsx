'use client'

import { useEffect, useState } from 'react'
import { SalesPointsPanel } from '@/components/brand/SalesPointsPanel'

/** Puntos de venta de la marca de la sesión (el id sale de /api/brand/me; el servidor valida rol y estado). */
export function BrandSalesPoints() {
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    fetch('/api/brand/me').then(r => r.json()).then(j => { if (j?.data?.id) setBrand({ id: j.data.id, name: j.data.name }) }).catch(() => {})
  }, [])
  if (!brand) return null
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-base font-bold text-gray-900">Puntos de venta y e-commerce</h2>
      <SalesPointsPanel brandId={brand.id} brandName={brand.name} portal="brand" />
    </div>
  )
}
