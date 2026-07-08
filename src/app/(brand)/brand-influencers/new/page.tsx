import type { Metadata } from 'next'
import { BrandNewInfluencerForm } from './BrandNewInfluencerForm'

export const metadata: Metadata = { title: 'Agregar influencer' }

// Form propio y mínimo para marca (no reusa el form de 4 pasos del admin) —
// pedido por Pri: la marca solo carga nombre/instagram/email/teléfono/
// dirección; bio, categorías, tarifas y redes adicionales las completa la
// influencer desde su propio perfil. Apunta a /api/brand/influencers, que
// resuelve brand_id/organization_id server-side, nunca desde el formulario.
export default function BrandNewInfluencerPage() {
  return <BrandNewInfluencerForm />
}
