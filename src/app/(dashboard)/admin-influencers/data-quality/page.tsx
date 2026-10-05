import { Suspense } from 'react'
import { DataQualityClient } from './DataQualityClient'

export const metadata = { title: 'Data Quality · SCENCE' }

export default function DataQualityPage() {
  // Suspense: el drilldown lee ?geo= con useSearchParams.
  return <Suspense><DataQualityClient /></Suspense>
}
