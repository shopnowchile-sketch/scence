import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'CLP'): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: string | Date, fmt = 'd MMM yyyy'): string {
  return format(new Date(date), fmt, { locale: es })
}

export function formatDatetime(date: string | Date): string {
  return format(new Date(date), "d MMM yyyy 'a las' HH:mm", { locale: es })
}

export function timeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: es })
}

export function formatFollowers(n: number | null | undefined): string {
  // FIX (bug visto en vivo, 2026-07-13): influencers sin sync de followers
  // traen `null` desde la base (influencer_social_profiles.followers) y
  // varios callers (ej. InfluencerTable.tsx, InfluencerCard.tsx) lo pasaban
  // sin default — crasheaba toda la pantalla con "Cannot read properties of
  // null (reading 'toString')". Se normaliza acá, en el único lugar, en vez
  // de parchar cada caller.
  const num = n ?? 0
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`
  return num.toString()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

/** Construye la URL de embed de Google Maps para una dirección */
export function buildGoogleMapsEmbedUrl(address: string): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const q = encodeURIComponent(address)
  return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}&language=es`
}

/** Construye el link de navegación de Google Maps */
export function buildGoogleMapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X / Twitter',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  twitch: 'Twitch',
  snapchat: 'Snapchat',
}

export const PLATFORM_ICONS: Record<string, string> = {
  instagram: '📸',
  tiktok: '🎵',
  youtube: '▶️',
  twitter: '𝕏',
  facebook: '👤',
  linkedin: '💼',
  pinterest: '📌',
  twitch: '🎮',
  snapchat: '👻',
}

export const CATEGORY_OPTIONS = [
  'Moda', 'Belleza', 'Fitness', 'Lifestyle', 'Gaming',
  'Tech', 'Viajes', 'Gastronomía', 'Música', 'Deportes',
  'Humor', 'Educación', 'Emprendimiento', 'Arte', 'Maternidad',
]

export const COUNTRY_OPTIONS = [
  { code: 'MX', label: 'México' },
  { code: 'CO', label: 'Colombia' },
  { code: 'AR', label: 'Argentina' },
  { code: 'CL', label: 'Chile' },
  { code: 'PE', label: 'Perú' },
  { code: 'US', label: 'Estados Unidos' },
  { code: 'ES', label: 'España' },
  { code: 'BR', label: 'Brasil' },
]
