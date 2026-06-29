import type { Metadata } from 'next'
import { NewInfluencerForm } from './NewInfluencerForm'

export const metadata: Metadata = { title: 'Nuevo influencer' }

export default function NewInfluencerPage() {
  return <NewInfluencerForm />
}
