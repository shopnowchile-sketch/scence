import type { Metadata } from 'next'
import { CampaignFormView } from '@/components/campaigns/CampaignFormView'

export const metadata: Metadata = { title: 'Nueva campaña' }

export default function NewCampaignPage() {
  return <CampaignFormView mode="admin" />
}
