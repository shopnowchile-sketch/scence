import { redirect } from 'next/navigation'

export default function LegacyBrandCampaignDetailPage({ params }: { params: { id: string } }) {
  redirect(`/brand-campaigns/${params.id}`)
}
