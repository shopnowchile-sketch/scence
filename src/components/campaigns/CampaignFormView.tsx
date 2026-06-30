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

import { CampaignForm } from '@/app/(dashboard)/admin-campaigns/new/CampaignForm'

export type CampaignFormMode = 'admin' | 'brand'

export function CampaignFormView({ mode }: { mode: CampaignFormMode }) {
  return (
    <CampaignForm
      apiEndpoint={mode === 'brand' ? '/api/brand/campaigns' : '/api/campaigns'}
      redirectBase={mode === 'brand' ? '/brand-campaigns' : '/admin-campaigns'}
      portal={mode}
    />
  )
}
