'use client'

import {
  LayoutDashboard,
  Target,
  Users,
  Trophy,
  CreditCard,
  Building2,
  Bug,
  Settings,
} from 'lucide-react'
import { AppSidebar, type NavSection } from '@/components/layout/AppSidebar'

const navSections: NavSection[] = [
  {
    title: 'Principal',
    items: [
      { href: '/brand-dash',        label: 'Dashboard',   icon: LayoutDashboard, exact: true },
      { href: '/brand-campaigns',   label: 'Campañas',    icon: Target },
      { href: '/brand-influencers', label: 'Influencers', icon: Users, exact: true },
      { href: '/brand-influencers/ranking', label: 'Ranking', icon: Trophy },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { href: '/brand-billing', label: 'Billing', icon: CreditCard },
      { href: '/brand-brands',  label: 'Marcas',  icon: Building2 },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/brand-support',          label: 'Soporte',       icon: Bug },
      { href: '/brand-settings/organization', label: 'Configuración', icon: Settings },
    ],
  },
]

export function BrandSidebar() {
  return <AppSidebar portal="brand" navSections={navSections} />
}
