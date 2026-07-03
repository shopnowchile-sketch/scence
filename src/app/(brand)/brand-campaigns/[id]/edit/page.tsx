import type { Metadata } from 'next'
import { CampaignEditForm } from '@/app/(dashboard)/admin-campaigns/[id]/edit/CampaignEditForm'

export const metadata: Metadata = { title: 'Editar campaña' }

// Ruta que faltaba (bug reportado: "Editar" en portal marca daba 404).
// Reutiliza el mismo formulario de edición del admin — no se duplica lógica —
// con portal="brand" para ajustar rutas de vuelta/redirect y ocultar el
// selector de marca (admin-only).
export default function EditBrandCampaignPage({ params }: { params: { id: string } }) {
  return <CampaignEditForm id={params.id} portal="brand" />
}
