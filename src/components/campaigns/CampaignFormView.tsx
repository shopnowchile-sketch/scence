'use client'

/**
 * CampaignFormView — Punto de entrada único para crear campañas.
 *
 * mode="admin"  → CampaignForm existente (multi-step, Zod, deliverable templates)
 * mode="brand"  → BrandCampaignForm (single-page, visibility, max influencers)
 *
 * Uso:
 *   <CampaignFormView mode="admin" />
 *   <CampaignFormView mode="brand" />
 */

import { CampaignForm }     from '@/app/(dashboard)/admin-campaigns/new/CampaignForm'
import { BrandCampaignForm } from './CampaignFormView.brand'

export type CampaignFormMode = 'admin' | 'brand'

export function CampaignFormView({ mode }: { mode: CampaignFormMode }) {
  if (mode === 'brand') return <BrandCampaignForm />
  return <CampaignForm />
}
