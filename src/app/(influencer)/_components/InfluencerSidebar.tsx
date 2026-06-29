'use client'

import { LayoutDashboard, CheckSquare, Briefcase, Calendar, Bug } from 'lucide-react'
import { AppSidebar, type NavSection } from '@/components/layout/AppSidebar'

const navSections: NavSection[] = [
  {
    title: 'Mi Portal',
    items: [
      { href: '/inf-dash',      label: 'Dashboard',   icon: LayoutDashboard, exact: true },
      { href: '/inf-tasks',     label: 'Entregables', icon: CheckSquare },
      { href: '/inf-campaigns', label: 'Campañas',    icon: Briefcase },
      { href: '/inf-bookings',  label: 'Bookings',    icon: Calendar },
      { href: '/inf-support',   label: 'Soporte',     icon: Bug },
    ],
  },
]

export function InfluencerSidebar() {
  return <AppSidebar portal="influencer" navSections={navSections} />
}
