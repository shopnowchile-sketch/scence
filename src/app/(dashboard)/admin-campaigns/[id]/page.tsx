import type { Metadata } from 'next'
import { CampaignDetailView } from '@/components/campaigns/CampaignDetailView'

export const metadata: Metadata = { title: 'Detalle de campaña' }

export default function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { tab?: string }
}) {
  const validTabs = ['overview', 'influencers', 'deliverables', 'canjes', 'history'] as const
  type Tab = typeof validTabs[number]
  const defaultTab = validTabs.includes(searchParams?.tab as Tab)
    ? (searchParams!.tab as Tab)
    : 'overview'
  return <CampaignDetailView mode="admin" id={params.id} defaultTab={defaultTab} />
}
