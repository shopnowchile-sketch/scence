import { CampaignDetailView } from '@/components/campaigns/CampaignDetailView'

export default function BrandCampaignDetailPage({ params }: { params: { id: string } }) {
  return <CampaignDetailView mode="brand" id={params.id} />
}
