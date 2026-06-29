import type { Metadata } from 'next'
import { InfluencerEditForm } from './InfluencerEditForm'

export const metadata: Metadata = { title: 'Editar influencer — SCENCE' }

export default function InfluencerEditPage({ params }: { params: { id: string } }) {
  return <InfluencerEditForm id={params.id} />
}
