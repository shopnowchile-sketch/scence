'use client'

import { Building2, Instagram } from 'lucide-react'
import { cn } from '@/lib/utils'

const COVER_STYLES = [
  'from-violet-700 via-violet-600 to-fuchsia-500',
  'from-sky-700 via-cyan-600 to-emerald-400',
  'from-rose-600 via-pink-500 to-orange-300',
  'from-slate-800 via-indigo-800 to-violet-600',
  'from-emerald-800 via-teal-600 to-lime-400',
]

function colorFor(value: string) {
  return COVER_STYLES[Math.abs(value.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % COVER_STYLES.length]
}

export function CampaignCover({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  if (src) return <div className={cn('relative overflow-hidden bg-gray-100', className)}>
    <img src={src} alt={`Portada de ${name}`} className="h-full w-full object-cover" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
    <p className="absolute bottom-3 left-4 right-4 text-lg font-bold leading-tight text-white drop-shadow-sm line-clamp-2">{name}</p>
  </div>
  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-br', colorFor(name), className)}>
      <div className="absolute -right-7 -top-10 h-40 w-40 rounded-full bg-white/15" />
      <div className="absolute -bottom-12 left-10 h-36 w-36 rounded-full border-[18px] border-white/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
      <p className="absolute bottom-3 left-4 right-4 text-lg font-bold leading-tight text-white drop-shadow-sm line-clamp-2">{name}</p>
    </div>
  )
}

export function BrandBadge({ name, logoUrl, instagram, compact = false }: { name: string | null; logoUrl?: string | null; instagram?: string | null; compact?: boolean }) {
  const handle = instagram?.replace(/^@/, '')
  const content = <>
    {logoUrl ? <img src={logoUrl} alt={name ?? ''} className={cn('rounded-lg bg-white object-contain', compact ? 'h-6 w-6' : 'h-8 w-8')} /> : <span className={cn('rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center', compact ? 'h-6 w-6' : 'h-8 w-8')}><Building2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} /></span>}
    <span className="min-w-0"><span className={cn('block truncate font-semibold text-gray-700', compact ? 'text-[11px]' : 'text-xs')}>{name ?? 'Marca'}</span>{handle && <span className="flex items-center gap-1 text-[11px] font-medium text-fuchsia-600"><Instagram className="h-3 w-3" />@{handle}</span>}</span>
  </>
  return handle ? <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:opacity-80">{content}</a> : <div className="flex min-w-0 items-center gap-2">{content}</div>
}
