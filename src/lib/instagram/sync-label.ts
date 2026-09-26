/**
 * Texto de estado del dato de followers de Instagram (lógica pura, testeable).
 * La UI nunca muestra un número viejo o un 0 no confirmado como si fuera actual.
 */
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

export type IgSyncFields = {
  platform?: string | null
  sync_status?: string | null
  synced_at?: string | null
  followers?: number | null
}

export type IgSyncTone = 'muted' | 'warn' | 'error'

const STALE_MS = 7 * 24 * 60 * 60_000

export function igSyncLabel(sp: IgSyncFields, now: Date = new Date()): { text: string; tone: IgSyncTone } | null {
  if (sp.platform !== 'instagram' || !sp.sync_status) return null
  switch (sp.sync_status) {
    case 'ok': {
      if (!sp.synced_at) return { text: 'Sincronización pendiente', tone: 'warn' }
      const ago = formatDistanceToNow(new Date(sp.synced_at), { addSuffix: true, locale: es })
      return { text: `Actualizado ${ago}`, tone: now.getTime() - Date.parse(sp.synced_at) > STALE_MS ? 'warn' : 'muted' }
    }
    case 'pending':
      return { text: 'Sincronización pendiente', tone: 'warn' }
    case 'not_found':
      return { text: 'No sincronizable: cuenta personal o @ incorrecto', tone: 'error' }
    default:
      return { text: 'Error de sincronización, se reintentará', tone: 'error' }
  }
}

/** true si el followers es 0 y no está confirmado por Instagram (se muestra "—"). */
export function hideUnconfirmedZero(sp: IgSyncFields): boolean {
  return sp.platform === 'instagram' && !sp.followers && sp.sync_status !== 'ok'
}
