'use client'

import { useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CampaignImageLightbox({ src, alt, children, className }: { src: string; alt: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Abrir imagen" aria-label={`Abrir ${alt}`} className={cn('relative block cursor-zoom-in overflow-hidden text-left', className)}>
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" onMouseDown={() => setOpen(false)}>
          <div className="relative h-[min(82vh,900px)] w-full max-w-5xl" onMouseDown={event => event.stopPropagation()}>
            <Image src={src} alt={alt} fill sizes="100vw" className="object-contain" priority />
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar imagen" className="absolute right-2 top-2 z-10 rounded-full bg-white/95 p-2 text-gray-700 shadow hover:bg-white"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
    </>
  )
}
