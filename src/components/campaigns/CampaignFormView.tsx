'use client'

/**
 * CampaignFormView — Punto de entrada único para crear campañas.
 *
 * Un solo componente compartido (CampaignForm) configurado por portal:
 *   mode="admin" → CampaignForm portal="admin" (sin gating de plan)
 *   mode="brand" → CampaignForm portal="brand" + planGating (endpoint de marca)
 *
 * Ya NO existe un formulario paralelo de marca: BrandCampaignForm fue eliminado
 * y su lógica de plan se integró en CampaignForm (prop planGating).
 */

import { CampaignForm } from '@/app/(dashboard)/admin-campaigns/new/CampaignForm'

export type CampaignFormMode = 'admin' | 'brand'

export function CampaignFormView({ mode }: { mode: CampaignFormMode }) {
  if (mode === 'brand') {
    return (
      <CampaignForm
        apiEndpoint="/api/brand/campaigns"
        redirectBase="/brand-campaigns"
        portal="brand"
        planGating
      />
    )
  }

  return (
    <CampaignForm
      apiEndpoint="/api/campaigns"
      redirectBase="/admin-campaigns"
      portal="admin"
    />
  )
}
