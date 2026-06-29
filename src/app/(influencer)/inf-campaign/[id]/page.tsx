import { CampaignDetailView } from '@/components/campaigns/CampaignDetailView'

export default function InfluencerCampaignDetailPage({ params }: { params: { id: string } }) {
  return <CampaignDetailView mode="influencer" id={params.id} />
}
