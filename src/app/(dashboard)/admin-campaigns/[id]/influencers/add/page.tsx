import type { Metadata } from 'next'
import { AddInfluencerClient } from './AddInfluencerClient'

export const metadata: Metadata = { title: 'Agregar influencer a campaña' }

export default function AddInfluencerPage({ params }: { params: { id: string } }) {
  return <AddInfluencerClient campaignId={params.id} />
}
