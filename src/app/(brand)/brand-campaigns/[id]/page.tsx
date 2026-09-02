import { CampaignDetail } from '@/app/(dashboard)/admin-campaigns/[id]/CampaignDetail'

export default function BrandCampaignDetailPage({ params }: { params: { id: string } }) {
  return <CampaignDetail key={params.id} id={params.id} defaultTab="overview" portal="brand" />
}
