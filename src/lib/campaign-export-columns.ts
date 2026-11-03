// Catálogo CERRADO de columnas de la exportación de influencers de una campaña (fuente única para API y pantalla).
// El servidor solo acepta claves de esta lista. La exportación completa es exclusiva del Super Admin.
// Módulo PURO (cliente y servidor).

export type ExportColumnKey =
  | 'name' | 'instagram' | 'followers' | 'engagement' | 'rut' | 'phone' | 'whatsapp' | 'email'
  | 'attendance' | 'commune' | 'region' | 'country' | 'categories' | 'deliverables' | 'fee' | 'currency' | 'accepted_at'

export const EXPORT_COLUMNS: ReadonlyArray<{ key: ExportColumnKey; label: string; width: number }> = [
  { key: 'name', label: 'Nombre', width: 28 },
  { key: 'rut', label: 'RUT', width: 16 },
  { key: 'email', label: 'Email', width: 30 },
  { key: 'phone', label: 'Teléfono', width: 18 },
  { key: 'whatsapp', label: 'WhatsApp', width: 18 },
  { key: 'instagram', label: 'Instagram', width: 22 },
  { key: 'followers', label: 'Seguidores', width: 12 },
  { key: 'engagement', label: 'Engagement (%)', width: 16 },
  { key: 'attendance', label: 'Estado de asistencia', width: 22 },
  { key: 'commune', label: 'Comuna', width: 20 },
  { key: 'region', label: 'Región', width: 22 },
  { key: 'country', label: 'País', width: 16 },
  { key: 'categories', label: 'Categorías', width: 30 },
  { key: 'deliverables', label: 'Estado de entregables', width: 26 },
  { key: 'fee', label: 'Fee', width: 14 },
  { key: 'currency', label: 'Moneda', width: 10 },
  { key: 'accepted_at', label: 'Fecha de aceptación', width: 22 },
]

/** Selección por defecto = columnas históricas de la descarga (sin cambios para quien no elige nada). */
export const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  'name', 'rut', 'email', 'phone', 'whatsapp', 'instagram', 'followers', 'engagement', 'commune', 'categories', 'fee', 'currency', 'accepted_at',
]

/** aprobadas = aceptadas aún sin confirmar asistencia · confirmadas = aceptadas con asistencia confirmada · all = ambas. */
export const EXPORT_FILTERS = ['confirmed', 'approved', 'all'] as const
export type ExportFilter = (typeof EXPORT_FILTERS)[number]
export const EXPORT_FILTER_LABELS: Record<ExportFilter, string> = {
  approved: 'Aprobadas (sin confirmar)',
  confirmed: 'Confirmadas',
  all: 'Ambas',
}

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

const KEYS = new Set<string>(EXPORT_COLUMNS.map(column => column.key))

/** Claves válidas del catálogo, en el orden del catálogo, sin duplicados. Desconocidas se descartan. */
export function parseExportColumns(raw: string | null | undefined): ExportColumnKey[] {
  const requested = new Set(String(raw ?? '').split(',').map(part => part.trim()).filter(key => KEYS.has(key)))
  return EXPORT_COLUMNS.map(column => column.key).filter(key => requested.has(key))
}

export function parseExportFilter(raw: string | null | undefined): ExportFilter {
  return (EXPORT_FILTERS as readonly string[]).includes(String(raw)) ? (raw as ExportFilter) : 'confirmed'
}

export function parseExportFormat(raw: string | null | undefined): ExportFormat {
  return raw === 'csv' ? 'csv' : 'xlsx'
}

/** Celda CSV (RFC 4180) y neutralización de fórmulas (=,+,-,@) para que Excel no ejecute texto de usuarios. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d[\d\s.,]*$/.test(text)) text = `'${text}`
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
