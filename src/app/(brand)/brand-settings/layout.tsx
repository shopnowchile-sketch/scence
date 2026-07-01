'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Users, MapPin, LayoutGrid, CreditCard, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/brand-settings/organization', label: 'Organización', icon: Building2 },
  { href: '/brand-settings/profile',      label: 'Perfil',       icon: User },
  { href: '/brand-settings/users',        label: 'Usuarios',     icon: Users },
  { href: '/brand-settings/locations',    label: 'Lugares',      icon: MapPin },
  { href: '/brand-settings/views',        label: 'Vistas',       icon: LayoutGrid },
  { href: '/brand-settings/billing',      label: 'Billing',      icon: CreditCard },
]

export default function BrandSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuración</h1>
        <p className="text-sm text-gray-500 mt-0.5">Administra tu marca, usuarios, lugares y vistas.</p>
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
                  active
                    ? 'border-violet-600 text-violet-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {children}
    </div>
  )
}
