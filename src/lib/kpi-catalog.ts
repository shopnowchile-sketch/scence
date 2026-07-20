export type KpiCategory =
  | 'campaigns'
  | 'influencers'
  | 'deliverables'
  | 'content'
  | 'finance'
  | 'barters'
  | 'affiliates'
  | 'commissions'

export type KpiAvailability = 'available' | 'partial' | 'planned'

export interface KpiDefinition {
  key: string
  label: string
  category: KpiCategory
  unit: 'count' | 'percent' | 'currency' | 'number'
  availability: KpiAvailability
  description: string
  dateField: string
  filters: Array<'organization' | 'date' | 'brand' | 'campaign' | 'influencer' | 'platform'>
}

/**
 * Catálogo único de KPI de Scence.
 *
 * Este archivo define nombres y alcance. Los cálculos siguen viviendo en las
 * consultas/API hasta que cada KPI tenga datos verificables. Nunca se deben
 * mostrar datos estimados como si fueran métricas reales.
 */
export const KPI_CATALOG: KpiDefinition[] = [
  { key: 'campaigns.total', label: 'Campañas', category: 'campaigns', unit: 'count', availability: 'available', description: 'Campañas creadas dentro del período.', dateField: 'campaigns.created_at', filters: ['organization', 'date', 'brand'] },
  { key: 'campaigns.active', label: 'Campañas activas', category: 'campaigns', unit: 'count', availability: 'available', description: 'Campañas cuyo estado es activo.', dateField: 'campaigns.created_at', filters: ['organization', 'date', 'brand'] },
  { key: 'campaigns.completed', label: 'Campañas completadas', category: 'campaigns', unit: 'count', availability: 'available', description: 'Campañas completadas dentro del período.', dateField: 'campaigns.updated_at', filters: ['organization', 'date', 'brand'] },
  { key: 'influencers.participants', label: 'Influencers participantes', category: 'influencers', unit: 'count', availability: 'available', description: 'Influencers únicos aceptados en campañas.', dateField: 'campaign_influencers.created_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'deliverables.total', label: 'Entregables', category: 'deliverables', unit: 'count', availability: 'available', description: 'Entregables individuales creados.', dateField: 'campaign_deliverables.created_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'deliverables.completed', label: 'Entregables completados', category: 'deliverables', unit: 'count', availability: 'available', description: 'Entregables aprobados o publicados.', dateField: 'campaign_deliverables.updated_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'deliverables.on_time_rate', label: 'Cumplimiento de fecha', category: 'deliverables', unit: 'percent', availability: 'available', description: 'Porcentaje entregado antes o en su fecha límite.', dateField: 'campaign_deliverables.submitted_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'content.views', label: 'Visualizaciones', category: 'content', unit: 'number', availability: 'available', description: 'Suma de visualizaciones verificadas por el proveedor de métricas.', dateField: 'campaign_deliverables.metrics_updated_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'content.interactions', label: 'Interacciones', category: 'content', unit: 'number', availability: 'partial', description: 'Likes y comentarios verificables. Shares y saves se agregarán cuando exista fuente real.', dateField: 'campaign_deliverables.metrics_updated_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'content.reach', label: 'Alcance', category: 'content', unit: 'number', availability: 'planned', description: 'No disponible hasta contar con una fuente verificable.', dateField: 'campaign_deliverables.metrics_updated_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer', 'platform'] },
  { key: 'finance.budget', label: 'Presupuesto', category: 'finance', unit: 'currency', availability: 'available', description: 'Presupuesto total de campañas.', dateField: 'campaigns.created_at', filters: ['organization', 'date', 'brand', 'campaign'] },
  { key: 'finance.spent', label: 'Inversión ejecutada', category: 'finance', unit: 'currency', availability: 'available', description: 'Presupuesto ejecutado registrado en campañas.', dateField: 'campaigns.updated_at', filters: ['organization', 'date', 'brand', 'campaign'] },
  { key: 'finance.revenue', label: 'Facturación', category: 'finance', unit: 'currency', availability: 'available', description: 'Total de facturas no anuladas emitidas en el período.', dateField: 'invoices.issue_date', filters: ['organization', 'date', 'brand', 'campaign'] },
  { key: 'barters.value', label: 'Valor de canjes', category: 'barters', unit: 'currency', availability: 'partial', description: 'Suma de beneficios de valor fijo. Las comisiones se incorporan al confirmarse ventas.', dateField: 'barters.agreed_date', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'barters.pending', label: 'Canjes pendientes', category: 'barters', unit: 'count', availability: 'partial', description: 'Canjes cuyo estado simple es pendiente.', dateField: 'barters.agreed_date', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'barters.completed', label: 'Canjes completados', category: 'barters', unit: 'count', availability: 'partial', description: 'Canjes cuyo estado simple es completado.', dateField: 'barters.updated_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'affiliates.clicks', label: 'Clics de afiliados', category: 'affiliates', unit: 'number', availability: 'available', description: 'Clics registrados en enlaces de afiliados.', dateField: 'affiliate_clicks.created_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'affiliates.confirmed_sales', label: 'Ventas confirmadas', category: 'affiliates', unit: 'count', availability: 'planned', description: 'Conversiones individuales confirmadas mediante integración, webhook o importación.', dateField: 'affiliate_conversions.confirmed_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'affiliates.conversion_rate', label: 'Conversión', category: 'affiliates', unit: 'percent', availability: 'planned', description: 'Ventas confirmadas divididas por clics válidos.', dateField: 'affiliate_conversions.confirmed_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'commissions.generated', label: 'Comisión generada', category: 'commissions', unit: 'currency', availability: 'planned', description: 'Comisión calculada sobre ventas confirmadas.', dateField: 'affiliate_conversions.confirmed_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'commissions.pending', label: 'Comisión pendiente', category: 'commissions', unit: 'currency', availability: 'planned', description: 'Comisión confirmada aún no liquidada.', dateField: 'commission_settlements.created_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
  { key: 'commissions.paid', label: 'Comisión pagada', category: 'commissions', unit: 'currency', availability: 'planned', description: 'Comisión incluida en una liquidación pagada.', dateField: 'commission_settlements.paid_at', filters: ['organization', 'date', 'brand', 'campaign', 'influencer'] },
]

export function getKpiDefinition(key: string): KpiDefinition | undefined {
  return KPI_CATALOG.find(kpi => kpi.key === key)
}
