import type { Metadata } from 'next'
import { CampaignsClient } from './CampaignsClient'

export const metadata: Metadata = { title: 'Campañas' }

export default function CampaignsPage() {
  return <CampaignsClient />
}
