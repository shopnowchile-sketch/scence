'use client'

import { LayoutDashboard, Megaphone, Users, Bug, Settings } from 'lucide-react'
import { AppSidebar, type NavSection } from '@/components/layout/AppSidebar'

const navSections: NavSection[] = [
  {
    title: 'Principal',
    items: [
      { href: '/brand-dash',        label: 'Dashboard',   icon: LayoutDashboard, exact: true },
      { href: '/brand-campaigns',   label: 'Campañas',    icon: Megaphone },
      { href: '/brand-influencers', label: 'Influencers', icon: Users },
      { href: '/brand-support',      label: 'Soporte',       icon: Bug },
      { href: '/brand-settings/profile', label: 'Configuración', icon: Settings },
    ],
  },
]

export function BrandSidebar() {
  return <AppSidebar portal="brand" navSections={navSections} />
}
