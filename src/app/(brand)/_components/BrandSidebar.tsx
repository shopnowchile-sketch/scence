'use client'

import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Target,
  Users,
  Trophy,
  CreditCard,
  Building2,
  Bug,
  FileText,
  Sparkles,
  ArrowLeftRight,
} from 'lucide-react'
import { AppSidebar, type NavSection } from '@/components/layout/AppSidebar'

const navSections: NavSection[] = [
  {
    title: 'Principal',
    items: [
      { href: '/brand-dash',        label: 'Dashboard',   icon: LayoutDashboard, exact: true },
      { href: '/brand-campaigns',   label: 'Campañas',    icon: Target },
      { href: '/brand-opportunities', label: 'Oportunidades', icon: Sparkles },
      { href: '/brand-influencers', label: 'Influencers', icon: Users, exact: true },
      { href: '/brand-influencers/ranking', label: 'Ranking', icon: Trophy },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { href: '/brand-billing', label: 'Billing', icon: CreditCard },
      { href: '/brand-brands',  label: 'Marcas',  icon: Building2 },
      { href: '/brand-documents', label: 'Documentos', icon: FileText },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/brand-support',          label: 'Soporte',       icon: Bug },
    ],
  },
]

export function BrandSidebar({ plan }: { plan?: string | null }) {
  const [hasInfluencerAccess, setHasInfluencerAccess] = useState(false)

  // Solo controla la visibilidad del enlace. El portal influencer vuelve a
  // verificar influencer.user_id en servidor; esta consulta no autoriza nada.
  useEffect(() => {
    let active = true
    void fetch('/api/influencer/me', { cache: 'no-store' })
      .then(response => { if (active) setHasInfluencerAccess(response.ok) })
      .catch(() => { if (active) setHasInfluencerAccess(false) })
    return () => { active = false }
  }, [])

  const sections = hasInfluencerAccess
    ? [...navSections, { title: 'Cambiar portal', items: [{ href: '/inf-dash', label: 'Portal de influencer', icon: ArrowLeftRight }] }]
    : navSections

  return <AppSidebar portal="brand" navSections={sections} plan={plan} />
}
