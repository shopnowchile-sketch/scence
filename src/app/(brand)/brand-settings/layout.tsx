'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Building2, Users, MapPin, Bell, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
    { href: '/brand-settings/profile', label: 'Mi perfil', icon: User },
    { href: '/brand-settings/organization', label: 'Organización', icon: Building2 },
    { href: '/brand-settings/users', label: 'Usuarios', icon: Users },
    { href: '/brand-settings/locations', label: 'Lugares', icon: MapPin },
  { href: '/brand-settings/notifications', label: 'Notificaciones', icon: Bell,    soon: true },
  { href: '/brand-settings/security',      label: 'Seguridad',      icon: Shield,  soon: true },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuración</h1>
        <p className="text-sm text-gray-400 mt-0.5">Administra tu perfil y configuración de la organización</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <aside className="w-48 flex-shrink-0">
          <nav className="space-y-0.5">
            {TABS.map(({ href, label, icon: Icon, soon }) => (
              <Link
                key={href}
                href={soon ? '#' : href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  pathname === href
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  soon && 'opacity-40 cursor-not-allowed'
                )}
                onClick={e => soon && e.preventDefault()}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {soon && (
                  <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">soon</span>
                )}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}
