import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'
import { getCampaignDateKey } from '@/lib/attendance-state'
import { isAttendanceDeliverable, isDeliverableComplete, isDeliverableOverdue } from '@/lib/deliverable-status'

/**
 * Desempeño interno de una influencer. Fuente única: se CALCULA siempre desde los registros reales
 * (`campaign_deliverables`, `campaign_influencers`, `campaigns`); no se guarda ni duplica nada.
 *
 * Reglas:
 *  - Asistencia (entregable `event_attendance`): `attendance_outcome` manda. `attended` = asistió;
 *    `excused_absence` o respuesta «No asistiré» sin resultado = AVISÓ (cancelación); `no_show` = no asistió
 *    sin avisar. Solo `no_show` es incumplimiento. Una asistencia confirmada sin resultado aún no cuenta.
 *  - Contenido: completado según `isDeliverableComplete`; «atrasado» solo si la fecha límite ya pasó y no
 *    está completo (un entregable dentro de plazo es «pendiente» y nunca penaliza); «a tiempo» solo si hay
 *    fecha de entrega registrada y es ≤ fecha límite.
 *  - Campañas canceladas no cuentan como compromiso.
 *  - `compliance` (0-100) = puntos / compromisos resueltos: asistió 1, avisó 0.5, no asistió 0; entregable
 *    completado 1 (0.5 si llegó tarde), atrasado sin entregar 0. Sin compromisos resueltos → null (no se inventa).
 */

export type PerformanceDeliverable = {
  influencer_id: string | null
  campaign_id: string
  type: string | null
  status: string | null
  due_date: string | null
  content_url: string | null
  published_url: string | null
  submitted_at: string | null
  published_at: string | null
  attendance_response: string | null
  attendance_outcome: string | null
  campaign_status: string | null
  campaign_name?: string | null
}

export type CampaignParticipation = { influencer_id: string | null; campaign_id: string; campaign_status: string | null }

export type PerformanceSummary = {
  campaigns_completed: number
  campaigns_participated: number
  attendance: { attended: number; excused: number; no_show: number; pending: number }
  deliverables: { total: number; completed: number; pending: number; overdue: number; on_time: number; late: number }
  compliance: number | null
}

export type PerformanceHistoryItem = {
  date: string
  kind: 'attended' | 'excused' | 'no_show' | 'on_time' | 'late' | 'overdue'
  campaign_id: string
  campaign_name: string | null
}

export const EMPTY_PERFORMANCE: PerformanceSummary = {
  campaigns_completed: 0,
  campaigns_participated: 0,
  attendance: { attended: 0, excused: 0, no_show: 0, pending: 0 },
  deliverables: { total: 0, completed: 0, pending: 0, overdue: 0, on_time: 0, late: 0 },
  compliance: null,
}

type Classified =
  | { area: 'attendance'; kind: 'attended' | 'excused' | 'no_show' | 'pending'; date: string | null }
  | { area: 'content'; kind: 'on_time' | 'late' | 'completed' | 'overdue' | 'pending'; date: string | null }

export function classifyDeliverable(d: PerformanceDeliverable, todayKey: string): Classified | null {
  if (d.campaign_status === 'canceled') return null
  if (isAttendanceDeliverable(d)) {
    if (d.attendance_outcome === 'attended') return { area: 'attendance', kind: 'attended', date: d.due_date }
    if (d.attendance_outcome === 'excused_absence' || d.attendance_response === 'declined') {
      return { area: 'attendance', kind: 'excused', date: d.due_date }
    }
    if (d.attendance_outcome === 'no_show') return { area: 'attendance', kind: 'no_show', date: d.due_date }
    return { area: 'attendance', kind: 'pending', date: d.due_date }
  }
  if (isDeliverableComplete(d)) {
    const delivered = d.published_at ?? d.submitted_at
    if (!delivered || !d.due_date) return { area: 'content', kind: 'completed', date: d.due_date }
    const deliveredKey = getCampaignDateKey(new Date(delivered))
    return { area: 'content', kind: deliveredKey <= d.due_date.slice(0, 10) ? 'on_time' : 'late', date: deliveredKey }
  }
  if (isDeliverableOverdue(d, todayKey)) return { area: 'content', kind: 'overdue', date: d.due_date }
  return { area: 'content', kind: 'pending', date: d.due_date }
}

export function summarizePerformance(
  deliverables: PerformanceDeliverable[],
  participations: CampaignParticipation[],
  now = new Date(),
): { summary: PerformanceSummary; history: PerformanceHistoryItem[] } {
  const todayKey = getCampaignDateKey(now)
  const summary: PerformanceSummary = JSON.parse(JSON.stringify(EMPTY_PERFORMANCE))
  const history: PerformanceHistoryItem[] = []

  const active = participations.filter(p => p.campaign_status !== 'canceled')
  summary.campaigns_participated = new Set(active.map(p => p.campaign_id)).size
  summary.campaigns_completed = new Set(active.filter(p => p.campaign_status === 'completed').map(p => p.campaign_id)).size

  let points = 0
  let resolved = 0
  for (const d of deliverables) {
    const c = classifyDeliverable(d, todayKey)
    if (!c) continue
    if (c.area === 'attendance') {
      if (c.kind === 'attended') { summary.attendance.attended++; points += 1; resolved++ }
      else if (c.kind === 'excused') { summary.attendance.excused++; points += 0.5; resolved++ }
      else if (c.kind === 'no_show') { summary.attendance.no_show++; resolved++ }
      else summary.attendance.pending++
      if (c.kind !== 'pending' && c.date) history.push({ date: c.date, kind: c.kind, campaign_id: d.campaign_id, campaign_name: d.campaign_name ?? null })
      continue
    }
    summary.deliverables.total++
    if (c.kind === 'pending') { summary.deliverables.pending++; continue }
    if (c.kind === 'overdue') {
      summary.deliverables.overdue++; resolved++
      if (c.date) history.push({ date: c.date, kind: 'overdue', campaign_id: d.campaign_id, campaign_name: d.campaign_name ?? null })
      continue
    }
    summary.deliverables.completed++; resolved++
    if (c.kind === 'late') { summary.deliverables.late++; points += 0.5 } else { points += 1; if (c.kind === 'on_time') summary.deliverables.on_time++ }
    if (c.date && (c.kind === 'on_time' || c.kind === 'late')) history.push({ date: c.date, kind: c.kind, campaign_id: d.campaign_id, campaign_name: d.campaign_name ?? null })
  }
  summary.compliance = resolved > 0 ? Math.round((points / resolved) * 100) : null
  history.sort((a, b) => b.date.localeCompare(a.date))
  return { summary, history }
}

type RawDeliverable = Omit<PerformanceDeliverable, 'campaign_status' | 'campaign_name'> & {
  campaign: { name: string | null; status: string | null } | { name: string | null; status: string | null }[] | null
}
type RawParticipation = { influencer_id: string | null; campaign_id: string; campaign: { status: string | null } | { status: string | null }[] | null }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

const DELIVERABLE_SELECT = 'influencer_id, campaign_id, type, status, due_date, content_url, published_url, submitted_at, published_at, attendance_response, attendance_outcome, campaign:campaigns(name, status)'

/** Rendimiento de varias influencers con 2 consultas por lote (sin N+1). Falla cerrado: lanza si no puede leer. */
export async function loadPerformanceMap(
  admin: SupabaseClient,
  influencerIds: string[],
  opts: { withHistory?: boolean; now?: Date } = {},
): Promise<Map<string, { summary: PerformanceSummary; history: PerformanceHistoryItem[] }>> {
  const result = new Map<string, { summary: PerformanceSummary; history: PerformanceHistoryItem[] }>()
  const ids = Array.from(new Set(influencerIds.filter(Boolean)))
  const dByInf = new Map<string, PerformanceDeliverable[]>()
  const pByInf = new Map<string, CampaignParticipation[]>()

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const [dels, parts] = await Promise.all([
      fetchAllRows<RawDeliverable>((from, to) => admin.from('campaign_deliverables').select(DELIVERABLE_SELECT)
        .in('influencer_id', batch).order('id').range(from, to), { maxRows: 100000 }),
      fetchAllRows<RawParticipation>((from, to) => admin.from('campaign_influencers').select('influencer_id, campaign_id, campaign:campaigns(status)')
        .in('influencer_id', batch).eq('application_status', 'accepted').order('id').range(from, to), { maxRows: 100000 }),
    ])
    if (dels.error) throw dels.error
    if (parts.error) throw parts.error
    for (const r of dels.data) {
      const camp = one(r.campaign)
      const row: PerformanceDeliverable = { ...r, campaign_status: camp?.status ?? null, campaign_name: camp?.name ?? null }
      const list = dByInf.get(r.influencer_id as string) ?? []
      list.push(row); dByInf.set(r.influencer_id as string, list)
    }
    for (const r of parts.data) {
      const list = pByInf.get(r.influencer_id as string) ?? []
      list.push({ influencer_id: r.influencer_id, campaign_id: r.campaign_id, campaign_status: one(r.campaign)?.status ?? null })
      pByInf.set(r.influencer_id as string, list)
    }
  }
  for (const id of ids) {
    const { summary, history } = summarizePerformance(dByInf.get(id) ?? [], pByInf.get(id) ?? [], opts.now)
    result.set(id, { summary, history: opts.withHistory ? history.slice(0, 30) : [] })
  }
  return result
}

/**
 * Rangos de segmentación. `null`/ausente = sin límite. Un criterio activo NUNCA deja pasar a quien no tiene
 * el dato (sin seguidores, sin engagement, sin cumplimiento): no se inventan métricas.
 */
export type AudienceCriteria = {
  followers_min?: number | null; followers_max?: number | null
  engagement_min?: number | null; engagement_max?: number | null
  rating_min?: number | null; rating_max?: number | null
  campaigns_min?: number | null
  compliance_min?: number | null
  no_shows_max?: number | null
  late_max?: number | null
}

export const CRITERIA_KEYS: (keyof AudienceCriteria)[] = [
  'followers_min', 'followers_max', 'engagement_min', 'engagement_max', 'rating_min', 'rating_max',
  'campaigns_min', 'compliance_min', 'no_shows_max', 'late_max',
]

/** Normaliza lo que llega del cliente: solo claves conocidas y números finitos ≥ 0; vacío = sin límite. */
export function sanitizeCriteria(raw: unknown): AudienceCriteria {
  const out: AudienceCriteria = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of CRITERIA_KEYS) {
    const v = (raw as Record<string, unknown>)[key]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) out[key] = n
  }
  return out
}

export function hasCriteria(c: AudienceCriteria | null | undefined): boolean {
  return !!c && CRITERIA_KEYS.some(k => c[k] !== null && c[k] !== undefined)
}

export type CriteriaSubject = {
  followers: number | null
  engagement: number | null
  rating: number | null
  performance: PerformanceSummary | null
}

const inRange = (value: number | null, min?: number | null, max?: number | null) => {
  if (min == null && max == null) return true
  if (value == null) return false
  return (min == null || value >= min) && (max == null || value <= max)
}

export function matchesCriteria(c: AudienceCriteria | null | undefined, s: CriteriaSubject): boolean {
  if (!hasCriteria(c)) return true
  const k = c as AudienceCriteria
  if (!inRange(s.followers, k.followers_min, k.followers_max)) return false
  if (!inRange(s.engagement, k.engagement_min, k.engagement_max)) return false
  if (!inRange(s.rating, k.rating_min, k.rating_max)) return false
  const p = s.performance ?? EMPTY_PERFORMANCE
  if (k.campaigns_min != null && p.campaigns_completed < k.campaigns_min) return false
  if (k.compliance_min != null && (p.compliance == null || p.compliance < k.compliance_min)) return false
  if (k.no_shows_max != null && p.attendance.no_show > k.no_shows_max) return false
  if (k.late_max != null && p.deliverables.late + p.deliverables.overdue > k.late_max) return false
  return true
}
