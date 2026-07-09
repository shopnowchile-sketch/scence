import type { Metadata } from 'next'
import { Suspense } from 'react'
import { InfluencersClient } from '@/app/(dashboard)/admin-influencers/InfluencersClient'

export const metadata: Metadata = { title: 'Influencers' }

export default function BrandInfluencersPage() {
  // Suspense: InfluencersClient usa useSearchParams -- sin este boundary,
  // Next intenta prerenderizar esta página estática en build y falla.
  return (
    <Suspense fallback={null}>
      <InfluencersClient portal="brand" />
    </Suspense>
  )
}
