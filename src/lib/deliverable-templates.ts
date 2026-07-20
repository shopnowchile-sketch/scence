export const DELIVERABLE_DESCRIPTION_MAX = 3000

export type DeliverableTemplateItem = {
  description?: string
  due_date?: string
  scheduled_at?: string
}

export type DeliverableTemplateInput = {
  type: string
  quantity?: number
  title?: string
  description?: string
  due_date?: string
  scheduled_at?: string
  platform?: string
  items?: DeliverableTemplateItem[]
}

export type ExpandedDeliverableTemplate = {
  type: string
  title: string
  description: string | null
  due_date: string | null
  scheduled_at: string | null
  platform: string | null
  sequence_number: number
  quantity: 1
}

/** Convierte plantillas agrupadas en una pieza real por Reel, Story, etc. */
export function expandDeliverableTemplates(
  templates: DeliverableTemplateInput[]
): ExpandedDeliverableTemplate[] {
  return templates.flatMap(template => {
    const quantity = Math.max(1, Math.min(50, Number(template.quantity) || template.items?.length || 1))

    return Array.from({ length: quantity }, (_, index) => {
      const item = template.items?.[index]
      const sequenceNumber = index + 1
      const description = item?.description ?? template.description ?? null

      return {
        type: template.type,
        title: template.title || `${template.type} ${sequenceNumber} de ${quantity}`,
        description,
        due_date: normalizeDate(item?.due_date ?? template.due_date),
        scheduled_at: normalizeDateTime(item?.scheduled_at ?? template.scheduled_at),
        platform: template.platform ?? null,
        sequence_number: sequenceNumber,
        quantity: 1 as const,
      }
    })
  })
}

function normalizeDate(value?: string): string | null {
  if (!value) return null
  return value.split('T')[0] || null
}

function normalizeDateTime(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
