import type { Metadata } from 'next'
import { InfluencersClient } from './InfluencersClient'

export const metadata: Metadata = { title: 'Influencers' }

export default function InfluencersPage() {
  return <InfluencersClient />
}
