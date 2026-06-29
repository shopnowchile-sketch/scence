import type { SupabaseClient } from '@supabase/supabase-js'

// ── Mapeo: status de deliverable → status de influencer_task ─────────────────
const DELIVERABLE_TO_TASK_STATUS: Record<string, string> = {
  pending:   'pending',
  in_review: 'in_progress',
  approved:  'done',
  rejected:  'pending',
  published: 'done',
}

// ── Mapeo: tipo de deliverable → título legible ───────────────────────────────
const DELIVERABLE_TYPE_LABEL: Record<string, string> = {
  reel:             'Publicar Reel',
  story:            'Publicar Stories',
  post:             'Publicar Post',
  live:             'Hacer Live',
  event_attendance: 'Confirmar asistencia',
  event_checkin:    'Check-in en evento',
  send_content:     'Enviar contenido para revisión',
  ugc_video:        'Grabar Video UGC',
  blog_post:        'Publicar artículo',
  instagram_post:   'Publicar Post en Instagram',
  instagram_story:  'Publicar Stories en Instagram',
  instagram_reel:   'Publicar Reel en Instagram',
  tiktok:           'Publicar en TikTok',
  youtube:          'Publicar en YouTube',
  youtube_short:    'Publicar YouTube Short',
  podcast:          'Publicar Podcast',
  event_appearance: 'Asistir a evento',
  live_stream:      'Hacer Live Stream',
  ugc_photo:        'Entregar Foto UGC',
}

/**
 * syncDeliverableTask — crea o actualiza la influencer_task vinculada a un deliverable.
 * - Si no existe task para ese deliverable_id → la crea.
 * - Si ya existe → actualiza status y due_date.
 * - Non-fatal: si la migración FASE2 no fue aplicada aún, no rompe el flujo.
 */
export async function syncDeliverableTask(
  admin: SupabaseClient,
  opts: {
    organizationId:    string
    influencerId:      string
    deliverableId:     string
    campaignId:        string
    deliverableType:   string
    deliverableTitle:  string | null
    deliverableStatus: string
    dueDate:           string | null
  }
) {
  const {
    organizationId, influencerId, deliverableId, campaignId,
    deliverableType, deliverableTitle, deliverableStatus, dueDate,
  } = opts

  const taskTitle  = deliverableTitle || DELIVERABLE_TYPE_LABEL[deliverableType] || deliverableType
  const taskStatus = DELIVERABLE_TO_TASK_STATUS[deliverableStatus] ?? 'pending'

  try {
    const { data: existing } = await admin
      .from('influencer_tasks')
      .select('id')
      .eq('deliverable_id', deliverableId)
      .maybeSingle()

    if (existing) {
      await admin
        .from('influencer_tasks')
        .update({ status: taskStatus, due_date: dueDate ?? null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await admin
        .from('influencer_tasks')
        .insert({
          organization_id: organizationId,
          influencer_id:   influencerId,
          source_type:     'campaign',
          source_id:       campaignId,
          deliverable_id:  deliverableId,
          title:           taskTitle,
          description:     `Entregable de campaña — ${taskTitle}`,
          due_date:        dueDate ?? null,
          status:          taskStatus,
        })
    }
  } catch (e) {
    console.warn('[syncDeliverableTask] non-fatal:', (e as Error).message)
  }
}

// ── Task templates by source type ────────────────────────────────────────────

export type TaskTemplate = {
  title:       string
  description: string
  dueDaysOffset: number | null  // days after source date; null = use source date
}

export const CAMPAIGN_TASK_TEMPLATES: TaskTemplate[] = [
  { title: 'Aprobar brief',         description: 'Revisa y aprueba el brief de la campaña.',              dueDaysOffset: 3 },
  { title: 'Grabar contenido',      description: 'Crea y graba el contenido según los lineamientos.',      dueDaysOffset: 14 },
  { title: 'Entregar contenido',    description: 'Envía el contenido final para revisión de la marca.',    dueDaysOffset: 17 },
  { title: 'Publicar en redes',     description: 'Publica el contenido aprobado en tus redes sociales.',   dueDaysOffset: 21 },
]

export const BOOKING_TASK_TEMPLATES: TaskTemplate[] = [
  { title: 'Confirmar participación', description: 'Confirma que puedes asistir a la sesión o evento.', dueDaysOffset: 1 },
  { title: 'Asistir a la sesión',     description: 'Asiste puntualmente al lugar o link indicado.',      dueDaysOffset: null },
]

export const EVENT_TASK_TEMPLATES: TaskTemplate[] = [
  { title: 'Confirmar asistencia al evento', description: 'Confirma tu asistencia al evento.', dueDaysOffset: -3 },
  { title: 'Asistir al evento',              description: 'Preséntate al evento en la fecha y hora indicadas.', dueDaysOffset: null },
]

// ── Core helper ───────────────────────────────────────────────────────────────

export async function createInfluencerTasks(
  admin: SupabaseClient,
  opts: {
    organizationId: string
    influencerId:   string
    sourceType:     'campaign' | 'booking' | 'event'
    sourceId:       string
    sourceDate?:    string  // ISO date string — used as base for due_date offset
    templates?:     TaskTemplate[]
  }
) {
  const { organizationId, influencerId, sourceType, sourceId, sourceDate, templates } = opts

  let tpls: TaskTemplate[]
  if (templates) {
    tpls = templates
  } else if (sourceType === 'campaign') {
    tpls = CAMPAIGN_TASK_TEMPLATES
  } else if (sourceType === 'booking') {
    tpls = BOOKING_TASK_TEMPLATES
  } else {
    tpls = EVENT_TASK_TEMPLATES
  }

  const rows = tpls.map(t => {
    let due_date: string | null = null
    if (sourceDate) {
      const base = new Date(sourceDate)
      if (t.dueDaysOffset === null) {
        due_date = base.toISOString().split('T')[0]
      } else {
        base.setDate(base.getDate() + t.dueDaysOffset)
        due_date = base.toISOString().split('T')[0]
      }
    }
    return {
      organization_id: organizationId,
      influencer_id:   influencerId,
      source_type:     sourceType,
      source_id:       sourceId,
      title:           t.title,
      description:     t.description,
      due_date,
      status:          'pending',
    }
  })

  const { error } = await admin.from('influencer_tasks').insert(rows)
  if (error) {
    console.error('[createInfluencerTasks] failed:', error.message)
  }
}
