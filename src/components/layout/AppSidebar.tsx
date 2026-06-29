'use client'

/**
 * AppSidebar — Sidebar unificado para los 3 portales.
 *
 * Uso:
 *   <AppSidebar portal="admin" />
 *   <AppSidebar portal="brand" />
 *   <AppSidebar portal="influencer" />
 *
 * Las diferencias de nav, badges y cabecera se manejan internamente
 * según el portal. Un solo componente para mantener.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X, LogOut, ChevronDown, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Portal = 'admin' | 'brand' | 'influencer'

export interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  badge?: number | null
  badgeColor?: string
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

// ── Portal configs ────────────────────────────────────────────────────────────

const PORTAL_CONFIG: Record<Portal, { label: string; badgeColor: string; avatarGradient: string }> = {
  admin:      { label: 'Beta',       badgeColor: 'bg-gray-100 text-gray-400',    avatarGradient: 'from-pink-400 to-violet-500' },
  brand:      { label: 'Marca',      badgeColor: 'bg-blue-50 text-blue-600',     avatarGradient: 'from-blue-400 to-cyan-500' },
  influencer: { label: 'Influencer', badgeColor: 'bg-violet-50 text-violet-600', avatarGradient: 'from-pink-400 to-violet-500' },
}

// ── Sidebar content ───────────────────────────────────────────────────────────

function SidebarContent({
  portal, pathname, navSections,
  orgName, orgInitial,
  userName, userEmail, userInitial,
  onSignOut, onNavClick,
}: {
  portal: Portal
  pathname: string
  navSections: NavSection[]
  orgName?: string
  orgInitial?: string
  userName: string
  userEmail: string
  userInitial: string
  onSignOut: () => void
  onNavClick?: () => void
}) {
  const cfg = PORTAL_CONFIG[portal]

  return (
    <div className="flex flex-col h-full">

      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-gray-100 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white font-extrabold text-sm">S</div>
        <span className="text-base font-bold text-gray-900 tracking-tight">Scence</span>
        <span className={cn('ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full', cfg.badgeColor)}>
          {cfg.label}
        </span>
      </div>

      {/* Org pill (admin only) / User pill (brand + influencer) */}
      <div className="px-3 py-3 border-b border-gray-50 flex-shrink-0">
        {portal === 'admin' ? (
          <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {orgInitial ?? '?'}
            </div>
            <span className="text-sm font-semibold text-gray-900 flex-1 text-left truncate">
              {orgName || <span className="text-gray-300">Cargando…</span>}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
          </button>
        ) : (
          <div className="w-full flex items-center gap-2 px-2 py-2 rounded-lg bg-gray-50">
            <div className={cn('w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold flex-shrink-0', cfg.avatarGradient)}>
              {userInitial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{userName || userEmail}</div>
              <div className="text-[10px] text-gray-400">Portal {cfg.label}</div>
            </div>
          </div>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navSections.map((section, si) => (
          <div key={si} className={cn('mb-1', si > 0 && 'pt-2')}>
            {section.title && (
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider px-2 py-1">
                {section.title}
              </p>
            )}
            {section.items.map(({ href, label, icon: Icon, exact, badge, badgeColor }) => {
              const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
              return (
                <Link key={href} href={href} onClick={onNavClick} className={cn('nav-link', active && 'active')}>
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge !== null && badge !== undefined && badge > 0 && (
                    <span className={cn('text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center', badgeColor ?? 'bg-violet-600')}>
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 p-3 space-y-0.5 flex-shrink-0">
        {portal === 'admin' && (
          <Link href="/admin-settings/profile" onClick={onNavClick}
            className={cn('nav-link', pathname.startsWith('/admin-settings') && 'active')}>
            <Settings className="h-4 w-4" /> Configuración
          </Link>
        )}
        {portal === 'brand' && (
          <Link href="/brand-profile" onClick={onNavClick}
            className={cn('nav-link', pathname === '/brand-profile' && 'active')}>
            <Settings className="h-4 w-4" /> Mi perfil
          </Link>
        )}
        {portal === 'influencer' && (
          <Link href="/inf-profile" onClick={onNavClick}
            className={cn('nav-link', pathname === '/inf-profile' && 'active')}>
            <Settings className="h-4 w-4" /> Mi Perfil
          </Link>
        )}
        <div className="px-3 py-2 flex items-center gap-2.5">
          <div className={cn('w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold flex-shrink-0', cfg.avatarGradient)}>
            {userInitial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-900 truncate">{userName || userEmail || '…'}</div>
            <div className="text-[10px] text-gray-400 truncate">{userEmail}</div>
          </div>
          <button onClick={onSignOut} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Cerrar sesión">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AppSidebar ────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  portal: Portal
  navSections: NavSection[]
  /** Admin only — org display name */
  orgName?: string
}

export function AppSidebar({ portal, navSections, orgName }: AppSidebarProps) {
  const pathname      = usePathname()
  const router        = useRouter()
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [userName,    setUserName]    = useState('')
  const [userEmail,   setUserEmail]   = useState('')
  const [resolvedOrg, setResolvedOrg] = useState(orgName ?? '')

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? '')
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, display_name')
        .eq('id', user.id)
        .single()
      setUserName(profile?.display_name || profile?.full_name || user.email?.split('@')[0] || '')

      if (portal === 'admin' && !orgName) {
        const orgId = user.user_metadata?.organization_id as string | undefined
        if (orgId) {
          const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).single()
          setResolvedOrg(org?.name ?? (user.user_metadata?.organization_name as string ?? ''))
        }
      }
    })
  }, [portal, orgName])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const orgInitial  = resolvedOrg.charAt(0).toUpperCase() || '?'
  const userInitial = userName.charAt(0).toUpperCase() || userEmail.charAt(0).toUpperCase() || '?'

  const contentProps = {
    portal, pathname, navSections,
    orgName: resolvedOrg, orgInitial,
    userName, userEmail, userInitial,
    onSignOut: handleSignOut,
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-gray-100 flex items-center px-4 gap-3">
        <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
          <Menu className="h-5 w-5" />
        </button>
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white font-extrabold text-sm">S</div>
        <span className="text-base font-bold text-gray-900">Scence</span>
        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', PORTAL_CONFIG[portal].badgeColor)}>
          {PORTAL_CONFIG[portal].label}
        </span>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative w-72 bg-white h-full overflow-hidden shadow-2xl">
            <button onClick={() => setMobileOpen(false)} className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 text-gray-400 z-10">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent {...contentProps} onNavClick={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 min-w-[240px] bg-white border-r border-gray-100 flex-col h-screen overflow-hidden">
        <SidebarContent {...contentProps} />
      </aside>
    </>
  )
}
