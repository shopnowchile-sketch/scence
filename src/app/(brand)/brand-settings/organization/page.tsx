// Datos de empresa y contacto de la organización
import { Suspense } from 'react'
import { BrandOrgForm } from '@/components/brand/BrandOrgForm'

export default function BrandOrganizationPage() {
  return (
    <Suspense>
      <BrandOrgForm />
    </Suspense>
  )
}
