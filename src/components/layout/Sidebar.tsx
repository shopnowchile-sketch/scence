'use client'

import { useEffect, useState } from 'react'
import { useIsAdmin, type UserRole } from '@/hooks/useIsAdmin'
import {
  LayoutDashboard, Target, Users, CalendarDays,
  CreditCard, Banknote, FileText, BarChart3,
  Building2, Link2, Bug, CalendarCheck, Trophy, Contact } from 'lucide-react'
import { AppSidebar, type NavSection } from './AppSidebar'

export function Sidebar() {
  const { role } = useIsAdmin()
  const [campaignCount, setCampaignCount] = useState<number | null>(null)
  const [bookingCount,  setBookingCount]  = useState<number | null>(null)
  const [reviewCount,   setReviewCount]   = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/campaigns?limit=1').then(r => r.json()).then(d => { if (typeof d.total === 'number') setCampaignCount(d.total) }).catch(() => {})
    fetch('/api/bookings?limit=1').then(r => r.json()).then(d => { if (Array.isArray(d.data)) setBookingCount(d.data.length) }).catch(() => {})
    // Badge de "Campañas" = campañas NUEVAS creadas por una marca, pendientes
    // de aprobación de admin (status='pending_approval'). Antes mezclaba
    // postulaciones de influencers + deliverables en revisión, lo que daba
    // números enormes (191) sin relación con "hay campañas nuevas que
    // revisar" — Pri pidió que el conteo sea justo ese. Reusa el mismo
    // endpoint/filtro que ya alimenta la pestaña "Pendientes de aprobación"
    // en CampaignsClient.tsx (misma fuente de verdad, sin lógica nueva).
    fetch('/api/campaigns?status=pending_approval&limit=1').then(r => r.json()).then(d => {
      if (typeof d.total === 'number' && d.total > 0) setReviewCount(d.total)
    }).catch(() => {})
  }, [])

  const isAdmin = role && (['super_admin', 'brand_manager'] as UserRole[]).includes(role as UserRole)

  const navSections: NavSection[] = [
    {
      title: 'Principal',
      items: [
        { href: '/admin-dash',        label: 'Dashboard',   icon: LayoutDashboard, exact: true },
        { href: '/admin-campaigns',   label: 'Campañas',    icon: Target,          badge: reviewCount, badgeColor: 'bg-red-500' },
        ...(isAdmin ? [
          { href: '/admin-influencers', label: 'Influencers', icon: Users },
          { href: '/admin-influencers/ranking', label: 'Ranking', icon: Trophy },
        ] : []),
        { href: '/admin-bookings',    label: 'Bookings',    icon: CalendarDays,    badge: bookingCount, badgeColor: 'bg-amber-400' },
      ],
    },
    {
      title: 'Finanzas',
      items: [
        { href: '/admin-billing',   label: 'Billing',   icon: CreditCard },
        { href: '/admin-payroll',   label: 'Payroll',   icon: Banknote },
        { href: '/admin-contracts', label: 'Contratos', icon: FileText },
        { href: '/admin-brands',    label: 'Marcas',    icon: Building2 },
      ],
    },
    {
      title: 'Crecimiento',
      items: [
        ...(isAdmin ? [{ href: '/admin-crm', label: 'CRM', icon: Contact }] : []),
        { href: '/admin-affiliates', label: 'Afiliados', icon: Link2 },
        { href: '/admin-events',     label: 'Eventos',   icon: CalendarCheck },
        { href: '/admin-support',    label: 'Soporte',   icon: Bug },
      ],
    },
    {
      title: 'Reportes',
      items: [
        { href: '/admin-analytics', label: 'Analytics', icon: BarChart3 },
      ],
    },
  ]

  return <AppSidebar portal="admin" navSections={navSections} />
}
