import type { Metadata } from 'next'
import { CampaignEditForm } from './CampaignEditForm'

export const metadata: Metadata = { title: 'Editar campaña' }

export default function EditCampaignPage({ params }: { params: { id: string } }) {
  return <CampaignEditForm id={params.id} />
}
