import { createAdminClient } from '@/lib/supabase/server'
import {
  DELIVERABLE_DESCRIPTION_MAX,
  expandDeliverableTemplates,
  type DeliverableTemplateInput,
  type ExpandedDeliverableTemplate,
} from '@/lib/deliverable-templates'

type AdminClient = ReturnType<typeof createAdminClient>

type Assignment = {
  id: string
  influencer_id: string
  deliverables_spec: unknown
}

type ExistingDeliverable = {
  id: string
  campaign_influencer_id: string | null
  influencer_id: string | null
  type: string
  title: string | null
  description: string | null
  due_date: string | null
  scheduled_at: string | null
  platform: string | null
  sequence_number: number | null
  tag_brand_ids: string[] | null
  tag_handles: string[] | null
  status: string
  content_url: string | null
  published_url: string | null
  submitted_at: string | null
  attendance_response: string | null
  attendance_outcome: string | null
  created_at: string
}

export class DeliverableTemplateSyncError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message)
  }
}

export function normalizeDeliverableTemplates(value: unknown): DeliverableTemplateInput[] {
  if (!Array.isArray(value)) {
    throw new DeliverableTemplateSyncError('Los entregables deben ser una lista válida')
  }

  const seenTypes = new Set<string>()
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DeliverableTemplateSyncError(`El entregable ${index + 1} no es válido`)
    }

    const template = raw as Record<string, unknown>
    const type = typeof template.type === 'string' ? template.type.trim() : ''
    if (!type) throw new DeliverableTemplateSyncError(`El entregable ${index + 1} no tiene tipo`)
    if (seenTypes.has(type)) throw new DeliverableTemplateSyncError(`El tipo ${type} está repetido`)
    seenTypes.add(type)

    const quantity = Math.max(1, Math.min(50, Number(template.quantity) || 1))
    const description = typeof template.description === 'string' ? template.description : undefined
    if (description && description.length > DELIVERABLE_DESCRIPTION_MAX) {
      throw new DeliverableTemplateSyncError(`La descripción no puede superar ${DELIVERABLE_DESCRIPTION_MAX} caracteres`)
    }

    const items = Array.isArray(template.items)
      ? template.items.slice(0, quantity).map((item, itemIndex) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new DeliverableTemplateSyncError(`La pieza ${itemIndex + 1} de ${type} no es válida`)
          }
          const normalized = item as Record<string, unknown>
          const itemDescription = typeof normalized.description === 'string' ? normalized.description : undefined
          if (itemDescription && itemDescription.length > DELIVERABLE_DESCRIPTION_MAX) {
            throw new DeliverableTemplateSyncError(`La descripción no puede superar ${DELIVERABLE_DESCRIPTION_MAX} caracteres`)
          }
          return {
            description: itemDescription,
            due_date: typeof normalized.due_date === 'string' ? normalized.due_date : undefined,
            scheduled_at: typeof normalized.scheduled_at === 'string' ? normalized.scheduled_at : undefined,
            tag_brand_ids: optionalStringArray(normalized.tag_brand_ids),
            tag_handles: optionalStringArray(normalized.tag_handles),
          }
        })
      : undefined

    return {
      type,
      quantity,
      title: typeof template.title === 'string' ? template.title : undefined,
      description,
      due_date: typeof template.due_date === 'string' ? template.due_date : undefined,
      scheduled_at: typeof template.scheduled_at === 'string' ? template.scheduled_at : undefined,
      platform: typeof template.platform === 'string' ? template.platform : undefined,
      items,
      tag_brand_ids: stringArray(template.tag_brand_ids),
      tag_handles: stringArray(template.tag_handles),
    }
  })
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringArray(value) : undefined
}

function hasCustomSpec(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value !== 'string') return false
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

function keyOf(deliverable: Pick<ExpandedDeliverableTemplate, 'type' | 'sequence_number'>) {
  return `${deliverable.type}:${deliverable.sequence_number}`
}

function canDeleteDeliverable(deliverable: ExistingDeliverable) {
  return !deliverable.content_url &&
    !deliverable.published_url &&
    !deliverable.submitted_at &&
    !deliverable.attendance_response &&
    !deliverable.attendance_outcome &&
    !['in_review', 'approved', 'published'].includes(deliverable.status)
}

export async function syncCampaignDeliverablesFromTemplates({
  admin,
  campaignId,
  previousTemplates,
  nextTemplates,
}: {
  admin: AdminClient
  campaignId: string
  previousTemplates: DeliverableTemplateInput[]
  nextTemplates: DeliverableTemplateInput[]
}) {
  const previousExpanded = expandDeliverableTemplates(previousTemplates)
  const nextExpanded = expandDeliverableTemplates(nextTemplates)
  const previousKeys = new Set(previousExpanded.map(keyOf))
  const nextByKey = new Map(nextExpanded.map(deliverable => [keyOf(deliverable), deliverable]))

  const { data: assignmentRows, error: assignmentError } = await admin
    .from('campaign_influencers')
    .select('id, influencer_id, deliverables_spec')
    .eq('campaign_id', campaignId)
    .eq('application_status', 'accepted')

  if (assignmentError) throw new DeliverableTemplateSyncError(assignmentError.message, 500)

  // Invitaciones con deliverables_spec usan una pauta personalizada y no deben
  // cambiar cuando se edita la plantilla general de la campaña.
  const assignments = ((assignmentRows as Assignment[] | null) ?? []).filter(row => !hasCustomSpec(row.deliverables_spec))
  if (assignments.length === 0) return { created: 0, updated: 0, deleted: 0 }

  const assignmentIds = assignments.map(row => row.id)
  const { data: deliverableRows, error: deliverablesError } = await admin
    .from('campaign_deliverables')
    .select('id, campaign_influencer_id, influencer_id, type, title, description, due_date, scheduled_at, platform, sequence_number, tag_brand_ids, tag_handles, status, content_url, published_url, submitted_at, attendance_response, attendance_outcome, created_at')
    .eq('campaign_id', campaignId)
    .in('campaign_influencer_id', assignmentIds)
    .order('created_at', { ascending: true })

  if (deliverablesError) throw new DeliverableTemplateSyncError(deliverablesError.message, 500)

  const existing = (deliverableRows as ExistingDeliverable[] | null) ?? []
  const rowsByAssignment = new Map<string, ExistingDeliverable[]>()
  for (const row of existing) {
    if (!row.campaign_influencer_id) continue
    const rows = rowsByAssignment.get(row.campaign_influencer_id) ?? []
    rows.push(row)
    rowsByAssignment.set(row.campaign_influencer_id, rows)
  }

  const updates = new Map<string, { ids: string[]; values: Record<string, unknown> }>()
  const inserts: Array<Record<string, unknown>> = []
  const deleteIds: string[] = []

  for (const assignment of assignments) {
    const rows = rowsByAssignment.get(assignment.id) ?? []
    const matchedIds = new Set<string>()

    for (const desired of nextExpanded) {
      const exact = rows.find(row => !matchedIds.has(row.id) && row.type === desired.type && row.sequence_number === desired.sequence_number)
      const legacy = exact ?? rows.find(row => !matchedIds.has(row.id) && row.type === desired.type && row.sequence_number == null)
      if (legacy) {
        matchedIds.add(legacy.id)
        const desiredKey = keyOf(desired)
        const group: { ids: string[]; values: Record<string, unknown> } =
          updates.get(desiredKey) ?? { ids: [], values: deliverableValues(desired) }
        group.ids.push(legacy.id)
        updates.set(desiredKey, group)
      } else {
        inserts.push({
          campaign_id: campaignId,
          campaign_influencer_id: assignment.id,
          influencer_id: assignment.influencer_id,
          ...deliverableValues(desired),
          quantity: 1,
          status: 'pending',
        })
      }
    }

    for (const row of rows) {
      if (matchedIds.has(row.id)) continue
      const sequence = row.sequence_number ?? 1
      if (!previousKeys.has(`${row.type}:${sequence}`) || nextByKey.has(`${row.type}:${sequence}`)) continue
      if (!canDeleteDeliverable(row)) {
        throw new DeliverableTemplateSyncError(
          `No se puede quitar ${row.title ?? row.type} porque ya tiene contenido o actividad registrada`,
          409,
        )
      }
      deleteIds.push(row.id)
    }
  }

  for (const update of Array.from(updates.values())) {
    const { error } = await admin.from('campaign_deliverables').update(update.values).eq('campaign_id', campaignId).in('id', update.ids)
    if (error) throw new DeliverableTemplateSyncError(error.message, 500)
  }

  if (inserts.length > 0) {
    const { error } = await admin.from('campaign_deliverables').insert(inserts)
    if (error) throw new DeliverableTemplateSyncError(error.message, 500)
  }

  if (deleteIds.length > 0) {
    const { error } = await admin.from('campaign_deliverables').delete().eq('campaign_id', campaignId).in('id', deleteIds)
    if (error) throw new DeliverableTemplateSyncError(error.message, 500)
  }

  return {
    created: inserts.length,
    updated: Array.from(updates.values()).reduce((total, group) => total + group.ids.length, 0),
    deleted: deleteIds.length,
  }
}

function deliverableValues(deliverable: ExpandedDeliverableTemplate) {
  return {
    type: deliverable.type,
    title: deliverable.title,
    description: deliverable.description,
    due_date: deliverable.due_date,
    scheduled_at: deliverable.scheduled_at,
    platform: deliverable.platform,
    sequence_number: deliverable.sequence_number,
    tag_brand_ids: deliverable.tag_brand_ids,
    tag_handles: deliverable.tag_handles,
    updated_at: new Date().toISOString(),
  }
}
