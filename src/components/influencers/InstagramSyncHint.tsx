import { igSyncLabel, hideUnconfirmedZero, type IgSyncFields, type IgSyncTone } from '@/lib/instagram/sync-label'

/** Antigüedad / estado del dato de followers de Instagram (auditoría 2026-09-25). */
export { hideUnconfirmedZero }
export type { IgSyncFields }

const TONE: Record<IgSyncTone, string> = {
  muted: 'text-gray-400',
  warn: 'text-amber-600',
  error: 'text-red-600',
}

export function InstagramSyncHint({ profile, className = '' }: { profile: IgSyncFields; className?: string }) {
  const label = igSyncLabel(profile)
  if (!label) return null
  return <div className={`text-[11px] leading-tight ${TONE[label.tone]} ${className}`}>{label.text}</div>
}
