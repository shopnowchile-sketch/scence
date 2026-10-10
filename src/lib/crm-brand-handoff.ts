// Pase de un lead del CRM a Marcas. La marca se crea cuando el lead pasa a "Interesada" (o a un
// estado posterior si todavía no tenía marca): desde ahí se gestiona en Marcas, no en el CRM.
// Es idempotente: `crm_leads.converted_brand_id` evita crear una segunda marca.
export const BRAND_HANDOFF_STATUSES = ['interested', 'building', 'converted'] as const

export function shouldHandOffToBrand(status: unknown, convertedBrandId: string | null | undefined): boolean {
  return typeof status === 'string'
    && (BRAND_HANDOFF_STATUSES as readonly string[]).includes(status)
    && !convertedBrandId
}

const STATUS_LABEL: Record<string, string> = { interested: 'Interesada', building: 'Armando campaña', converted: 'Cerrada' }
export const handoffStatusLabel = (status: string) => STATUS_LABEL[status] ?? status
