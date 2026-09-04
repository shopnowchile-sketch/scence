'use client'

import { useEffect, useState } from 'react'
import type { UserRole } from '@/hooks/useIsAdmin'
import {
  LayoutDashboard, Target, Users, CalendarDays,
  CreditCard, Banknote, FileText, BarChart3,
  Building2, Link2, Bug, CalendarCheck, Trophy, Contact } from 'lucide-react'
import { AppSidebar, type NavSection } from './AppSidebar'

type NavigationSummary = { role: UserRole; bookings: number; pendingCampaigns: number; pendingBrands: number; openTickets: number }

function loadNavigationSummary() {
  return fetch('/api/navigation/summary', { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('No se pudo cargar la navegación')
    return r.json() as Promise<NavigationSummary>
  })
}

export function Sidebar() {
  const [role, setRole] = useState<UserRole>(null)
  const [bookingCount,  setBookingCount]  = useState<number | null>(null)
  const [reviewCount,   setReviewCount]   = useState<number | null>(null)
  const [brandCount,    setBrandCount]    = useState<number | null>(null)
  const [ticketCount,   setTicketCount]   = useState<number | null>(null)

  useEffect(() => {
    let active = true
    const refresh = () => loadNavigationSummary().then(d => {
        if (!active) return
        setRole(d.role ?? null)
        setBookingCount(typeof d.bookings === 'number' && d.bookings > 0 ? d.bookings : null)
        setReviewCount(typeof d.pendingCampaigns === 'number' && d.pendingCampaigns > 0 ? d.pendingCampaigns : null)
        setBrandCount(typeof d.pendingBrands === 'number' && d.pendingBrands > 0 ? d.pendingBrands : null)
        setTicketCount(typeof d.openTickets === 'number' && d.openTickets > 0 ? d.openTickets : null)
      }).catch(() => {})
    void refresh()
    // Los contadores de navegación no requieren tiempo real. Cinco minutos
    // reducen drásticamente invocaciones sin afectar el uso del portal.
    const interval = window.setInterval(refresh, 5 * 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const isAdmin = role && (['super_admin', 'brand_manager'] as UserRole[]).includes(role as UserRole)

  const navSections: NavSection[] = [
    {
      title: 'Principal',
      items: [
        { href: '/admin-dash',        label: 'Dashboard',   icon: LayoutDashboard, exact: true },
        { href: reviewCount ? '/admin-campaigns?status=pending_approval' : '/admin-campaigns', label: 'Campañas', icon: Target, badge: reviewCount, badgeColor: 'bg-red-500' },
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
        { href: '/admin-brands',    label: 'Marcas',    icon: Building2, badge: brandCount, badgeColor: 'bg-amber-500' },
        ...(isAdmin ? [{ href: '/admin-brands/users', label: 'Usuarios de marcas', icon: Users, subitem: true }] : []),
      ],
    },
    {
      title: 'Crecimiento',
      items: [
        ...(isAdmin ? [{ href: '/admin-crm', label: 'CRM', icon: Contact }] : []),
        { href: '/admin-affiliates', label: 'Afiliados', icon: Link2 },
        { href: '/admin-events',     label: 'Eventos',   icon: CalendarCheck },
        { href: '/admin-support',    label: 'Soporte',   icon: Bug, badge: ticketCount, badgeColor: 'bg-red-500' },
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
