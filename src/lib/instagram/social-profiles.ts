/**
 * Guardado de redes sociales desde formularios sin pisar el dato sincronizado.
 *
 * Regla (auditoría 2026-09-25): los followers de Instagram SOLO los escribe
 * syncInstagramFollowers(). Un formulario puede:
 *   - editar @, URL, principal y métricas de otras plataformas;
 *   - crear un perfil nuevo (su número queda como inicial, sync_status='pending');
 * pero nunca sobrescribir followers/synced_at de un Instagram existente.
 * Cambiar el @ deja el perfil 'pending' (conserva el último valor) para re-sync.
 *
 * Reemplaza el DELETE + INSERT anterior, que borraba synced_at y cambiaba ids.
 */
import { cleanInstagramHandle } from './business-discovery'

export type ExistingProfile = { id: string; platform: string; username: string | null }
export type IncomingProfile = Record<string, unknown>

/** Campos que nunca vienen del formulario (los administra el sistema). */
const SYSTEM_FIELDS = [
  'id', 'influencer_id', 'created_at', 'updated_at', 'followers_count', 'following_count',
  'synced_at', 'last_synced_at', 'sync_status', 'sync_error', 'sync_attempted_at', 'sync_locked_until', 'raw_data',
]

export type SocialProfilePlan = {
  updates: Array<{ id: string; values: Record<string, unknown> }>
  inserts: Array<Record<string, unknown>>
  deletes: string[]
  /** Perfiles de Instagram que deben sincronizarse ya (nuevos o con @ cambiado). */
  resyncExistingIds: string[]
  insertsNeedSync: boolean
}

function normalized(value: unknown): string {
  return cleanInstagramHandle(typeof value === 'string' ? value : null) ?? String(value ?? '').trim().replace(/^@/, '').toLowerCase()
}

export function planSocialProfileChanges(influencerId: string, existing: ExistingProfile[], incoming: IncomingProfile[]): SocialProfilePlan {
  const byPlatform = new Map(existing.map(row => [row.platform, row]))
  const seen = new Set<string>()
  const plan: SocialProfilePlan = { updates: [], inserts: [], deletes: [], resyncExistingIds: [], insertsNeedSync: false }

  for (const raw of incoming) {
    const platform = String(raw.platform ?? '')
    if (!platform || seen.has(platform)) continue // (influencer_id, platform) es único
    seen.add(platform)

    const values: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) if (!SYSTEM_FIELDS.includes(key)) values[key] = value
    const manualFollowers = Number(raw.followers_count ?? raw.followers ?? 0)
    delete values.followers

    const current = byPlatform.get(platform)
    if (current) {
      if (platform === 'instagram') {
        if (normalized(values.username) !== normalized(current.username)) {
          Object.assign(values, { sync_status: 'pending', sync_error: null, sync_attempted_at: null, synced_at: null, last_synced_at: null })
          plan.resyncExistingIds.push(current.id)
        }
      } else if (Number.isFinite(manualFollowers)) {
        values.followers = manualFollowers // otras plataformas no tienen sync: siguen manuales
      }
      plan.updates.push({ id: current.id, values })
    } else {
      values.influencer_id = influencerId
      values.followers = Number.isFinite(manualFollowers) && manualFollowers >= 0 ? manualFollowers : 0
      if (platform === 'instagram') { values.sync_status = 'pending'; plan.insertsNeedSync = true }
      plan.inserts.push(values)
    }
  }

  for (const row of existing) if (!seen.has(row.platform)) plan.deletes.push(row.id)
  return plan
}
