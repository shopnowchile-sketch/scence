import type { Metadata } from 'next'
import { CampaignsClient } from '@/app/(dashboard)/admin-campaigns/CampaignsClient'

export const metadata: Metadata = { title: 'Campañas' }

export default function BrandCampaignsPage() {
  return <CampaignsClient portal="brand" />
}
