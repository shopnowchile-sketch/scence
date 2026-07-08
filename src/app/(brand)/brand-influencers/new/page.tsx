import type { Metadata } from 'next'
import { NewInfluencerForm } from '@/app/(dashboard)/admin-influencers/new/NewInfluencerForm'

export const metadata: Metadata = { title: 'Agregar influencer' }

// Reusa el mismo formulario multi-step del admin, apuntando a la ruta de
// marca (/api/brand/influencers) — esa ruta resuelve brand_id/organization_id
// server-side desde el usuario autenticado, nunca acepta esos campos del
// formulario. La marca no tiene perfil propio de influencer aún, así que tras
// crear vuelve a su lista en vez de a un perfil individual.
export default function BrandNewInfluencerPage() {
  return (
    <NewInfluencerForm
      postUrl="/api/brand/influencers"
      redirectTo={() => '/brand-influencers'}
    />
  )
}
