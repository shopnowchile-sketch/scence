import type { Metadata } from 'next'
import { Suspense } from 'react'
import { InfluencersClient } from './InfluencersClient'

export const metadata: Metadata = { title: 'Influencers' }

export default function InfluencersPage() {
  // Suspense: InfluencersClient usa useSearchParams (modo "asignar a marca",
  // ?assignToBrand=...) -- sin este boundary, Next intenta prerenderizar
  // esta página estática en build y falla pidiendo el Suspense.
  return (
    <Suspense fallback={null}>
      <InfluencersClient />
    </Suspense>
  )
}
