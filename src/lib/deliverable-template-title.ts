// Antes de ser ACEPTADA, la influencer solo ve el TÍTULO de cada entregable; la descripción con las
// instrucciones (qué publicar, cómo, qué etiquetar) se libera al aceptar (CLAUDE.md §8: contenido privado).
// Fuente única: la usan la API (la descripción nunca sale del backend) y la vista.

type TemplateLike = { type: string; quantity?: number; title?: string | null; description?: string | null; due_date?: string | null }

const MAX_TITLE = 80
const TYPE_TITLES: Record<string, string> = {
  event_attendance: 'Confirmar asistencia al evento',
  reel: 'Reel',
  story: 'Historias',
  post: 'Post',
  tiktok: 'TikTok',
  other: 'Otro entregable',
}

/** title explícito → primera línea de la descripción si es corta (así se escribe el título) → nombre del tipo. */
export function deliverableTemplateTitle(t: TemplateLike): string {
  const explicit = t.title?.trim()
  if (explicit) return explicit.slice(0, MAX_TITLE * 2)
  const firstLine = (t.description ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  if (firstLine && firstLine.length <= MAX_TITLE && !/^https?:\/\//i.test(firstLine)) return firstLine
  return TYPE_TITLES[t.type] ?? t.type
}

/** Versión pública (pre-aceptación): tipo, cantidad, plazo y título. Sin descripción ni piezas. */
export function publicDeliverableTemplates(value: unknown): Array<{ type: string; quantity: number; title: string; due_date: string | null }> | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((t): t is TemplateLike => !!t && typeof t === 'object' && typeof (t as TemplateLike).type === 'string')
    .map(t => ({
      type: t.type,
      quantity: Number(t.quantity) || 1,
      title: deliverableTemplateTitle(t),
      due_date: typeof t.due_date === 'string' ? t.due_date : null,
    }))
}
