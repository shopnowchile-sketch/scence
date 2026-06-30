'use client'

/**
 * CampaignDetailView — Punto de entrada único para los 3 portales.
 *
 * mode="admin"      → CampaignDetail existente (admin completo, 4 tabs)
 * mode="brand"      → BrandCampaignView (review de deliverables)
 * mode="influencer" → InfluencerCampaignView (submit deliverables)
 *
 * Uso en cada portal:
 *   <CampaignDetailView mode="admin"      id={id} defaultTab="overview" />
 *   <CampaignDetailView mode="brand"      id={id} />
 *   <CampaignDetailView mode="influencer" id={id} />
 */

import { CampaignDetail }        from '@/app/(dashboard)/admin-campaigns/[id]/CampaignDetail'
import { BrandCampaignView }      from './CampaignDetailView.brand'
import { InfluencerCampaignView } from './CampaignDetailView.influencer'

export type CampaignDetailMode = 'admin' | 'brand' | 'influencer'

interface Props {
  id: string
  mode: CampaignDetailMode
  // Admin-only props
  defaultTab?: 'overview' | 'influencers' | 'deliverables' | 'canjes' | 'history'
}

export function CampaignDetailView({ id, mode, defaultTab = 'overview' }: Props) {
  if (mode === 'admin')      return <CampaignDetail id={id} defaultTab={defaultTab as any} />
  if (mode === 'brand')      return <BrandCampaignView id={id} />
  return <InfluencerCampaignView id={id} />
}
