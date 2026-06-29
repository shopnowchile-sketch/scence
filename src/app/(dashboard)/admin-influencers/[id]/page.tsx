import type { Metadata } from 'next'
import { InfluencerProfile } from './InfluencerProfile'

export const metadata: Metadata = { title: 'Perfil de influencer' }

export default function InfluencerProfilePage({ params }: { params: { id: string } }) {
  return <InfluencerProfile id={params.id} />
}
