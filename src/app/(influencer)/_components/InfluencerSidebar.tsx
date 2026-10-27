'use client'

import { LayoutDashboard, CheckSquare, Briefcase, Calendar, Bug, Building2, ArrowLeftRight } from 'lucide-react'
import { AppSidebar, type NavSection } from '@/components/layout/AppSidebar'

const navSections: NavSection[] = [
  {
    title: 'Mi Portal',
    items: [
      { href: '/inf-dash',      label: 'Dashboard',   icon: LayoutDashboard, exact: true },
      { href: '/inf-deliverables', label: 'Entregables', icon: CheckSquare },
      { href: '/inf-campaigns', label: 'Campañas',    icon: Briefcase },
      { href: '/inf-brands',    label: 'Mis marcas',  icon: Building2 },
      { href: '/inf-bookings',  label: 'Bookings',    icon: Calendar },
      { href: '/inf-support',   label: 'Soporte',     icon: Bug },
    ],
  },
]

export function InfluencerSidebar({ hasBrandAccess = false }: { hasBrandAccess?: boolean }) {
  const sections = hasBrandAccess
    ? [...navSections, { title: 'Cambiar portal', items: [{ href: '/brand-dash', label: 'Portal de marca', icon: ArrowLeftRight }] }]
    : navSections
  return <AppSidebar portal="influencer" navSections={sections} />
}
