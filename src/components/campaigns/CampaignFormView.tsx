'use client'

/**
 * CampaignFormView — Punto de entrada único para crear campañas.
 *
 * mode="admin"  → CampaignForm existente (multi-step, admin-only)
 * mode="brand"  → BrandCampaignForm (portal de marca, con gating de plan)
 *
 * Uso:
 *   <CampaignFormView mode="admin" />
 *   <CampaignFormView mode="brand" />
 */

import { CampaignForm } from '@/app/(dashboard)/admin-campaigns/new/CampaignForm'
import { BrandCampaignForm } from '@/components/campaigns/CampaignFormView.brand'

export type CampaignFormMode = 'admin' | 'brand'

export function CampaignFormView({ mode }: { mode: CampaignFormMode }) {
  if (mode === 'brand') {
    return <BrandCampaignForm />
  }

  return (
    <CampaignForm
      apiEndpoint="/api/campaigns"
      redirectBase="/admin-campaigns"
      portal="admin"
    />
  )
}
