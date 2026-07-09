import { redirect } from 'next/navigation'

// Duplicado real de /brand-dash — esta implementación completa vivía acá,
// sin link en el sidebar ni ningún otro lugar de la UI, solo alcanzable si
// alguien la tenía como bookmark o por el router.push viejo en
// CampaignFormView.brand.tsx (ya corregido a /brand-dash directo). Mismo
// patrón que los otros 2 shims legacy en esta carpeta (brand/campaigns).
export default function LegacyBrandDashboardPage() {
  redirect('/brand-dash')
}
