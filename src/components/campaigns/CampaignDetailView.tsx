'use client'

/**
 * CampaignDetailView — Punto de entrada para los portales Admin e Influencer.
 * (Marca reutiliza CampaignDetail directamente en brand-campaigns/[id]/page.tsx — no pasa por acá.)
 *
 * mode="admin"      → CampaignDetail existente (admin completo, 4 tabs)
 * mode="influencer" → InfluencerCampaignView (submit deliverables)
 *
 * Uso en cada portal:
 *   <CampaignDetailView mode="admin"      id={id} defaultTab="overview" />
 *   <CampaignDetailView mode="influencer" id={id} />
 *
 * NOTA (2026-07-01, gap G-16): existía un mode="brand" -> BrandCampaignView que ninguna
 * ruta real invocaba (Marca usa CampaignDetail directo). Se eliminó la rama muerta junto
 * con CampaignDetailView.brand.tsx tras confirmar por grep que no queda ninguna referencia.
 */

import { CampaignDetail }        from '@/app/(dashboard)/admin-campaigns/[id]/CampaignDetail'
import { InfluencerCampaignView } from './CampaignDetailView.influencer'

export type CampaignDetailMode = 'admin' | 'influencer'

interface Props {
  id: string
  mode: CampaignDetailMode
  // Admin-only props
  defaultTab?: 'overview' | 'influencers' | 'deliverables' | 'canjes' | 'history'
}

export function CampaignDetailView({ id, mode, defaultTab = 'overview' }: Props) {
  if (mode === 'admin') return <CampaignDetail id={id} defaultTab={defaultTab as any} />
  return <InfluencerCampaignView id={id} />
}
