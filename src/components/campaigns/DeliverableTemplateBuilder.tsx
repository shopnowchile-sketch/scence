'use client'

/**
 * DeliverableTemplateBuilder — Componente compartido para definir deliverables
 * en un formulario de campaña.
 *
 * Usado en:
 * - Admin: CampaignForm.tsx (paso 3 — Contenido)
 * - Brand: CampaignFormView.brand.tsx (sección Deliverables)
 */

import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliverableTemplate {
  type: string
  quantity: number
  description?: string
  due_date?: string   // fecha ISO completa con hora, ej: "2026-06-15T18:00"
}

// ── Deliverable types ─────────────────────────────────────────────────────────

export const DELIVERABLE_TYPES = [
  { value: 'reel',             label: 'Reel',                  emoji: '🎬' },
  { value: 'story',            label: 'Stories',               emoji: '📸' },
  { value: 'post',             label: 'Post / Feed',           emoji: '🖼️' },
  { value: 'live',             label: 'Live',                  emoji: '🔴' },
  { value: 'event_attendance', label: 'Confirmar asistencia',  emoji: '📅' },
  { value: 'event_checkin',    label: 'Check-in en evento',    emoji: '✅' },
  { value: 'send_content',     label: 'Enviar contenido',      emoji: '📤' },
  { value: 'ugc_video',        label: 'Video UGC',             emoji: '📹' },
  { value: 'blog_post',        label: 'Blog / Artículo',       emoji: '✍️' },
  { value: 'other',            label: 'Otro',                  emoji: '➕' },
] as const

export type DeliverableTypeValue = typeof DELIVERABLE_TYPES[number]['value']

// ── Default templates by campaign type ────────────────────────────────────────

export const CAMPAIGN_DELIVERABLE_DEFAULTS: Record<string, DeliverableTemplate[]> = {
  sponsored_post: [
    { type: 'send_content', quantity: 1, description: 'Enviar contenido para aprobación antes de publicar' },
    { type: 'post',         quantity: 1, description: 'Post en feed mencionando la marca' },
    { type: 'story',        quantity: 3, description: 'Stories con swipe up / link en bio' },
  ],
  ambassador: [
    { type: 'send_content', quantity: 1, description: 'Enviar contenido para aprobación' },
    { type: 'reel',         quantity: 2, description: 'Reel mostrando el producto/servicio' },
    { type: 'story',        quantity: 5, description: 'Stories mensuales de la marca' },
    { type: 'post',         quantity: 2, description: 'Post en feed' },
  ],
  event_appearance: [
    { type: 'event_attendance', quantity: 1, description: 'Confirmar asistencia al evento' },
    { type: 'event_checkin',    quantity: 1, description: 'Check-in presencial en el evento' },
    { type: 'story',            quantity: 3, description: 'Stories en vivo desde el evento' },
    { type: 'reel',             quantity: 1, description: 'Reel del evento (antes/durante/después)' },
    { type: 'send_content',     quantity: 1, description: 'Enviar contenido post-evento para aprobación' },
  ],
  product_seeding: [
    { type: 'send_content', quantity: 1, description: 'Enviar unboxing / reseña para aprobación' },
    { type: 'story',        quantity: 2, description: 'Stories mostrando el producto recibido' },
    { type: 'post',         quantity: 1, description: 'Post con reseña del producto' },
  ],
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  value?: DeliverableTemplate[]
  onChange: (v: DeliverableTemplate[]) => void
  campaignType?: string
  /** Show suggested defaults banner */
  showSuggestions?: boolean
}

export function DeliverableTemplateBuilder({
  value = [],
  onChange,
  campaignType,
  showSuggestions = true,
}: Props) {
  const suggested = campaignType ? (CAMPAIGN_DELIVERABLE_DEFAULTS[campaignType] ?? []) : []

  function addType(type: string) {
    if (value.find(d => d.type === type)) return
    onChange([...value, { type, quantity: 1, description: '' }])
  }

  function remove(type: string) {
    onChange(value.filter(d => d.type !== type))
  }

  function update(type: string, field: string, val: unknown) {
    onChange(value.map(d => d.type === type ? { ...d, [field]: val } : d))
  }

  function applySuggested() {
    onChange(suggested.map(s => ({ ...s, due_date: '' })))
  }

  return (
    <div className="space-y-4">
      {/* Sugerencias por tipo de campaña */}
      {showSuggestions && suggested.length > 0 && value.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 border border-violet-100">
          <span className="text-violet-500 mt-0.5">✨</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-700">Deliverables sugeridos para este tipo de campaña</p>
            <p className="text-xs text-violet-500 mt-0.5">Se pre-cargarán al hacer clic — puedes editarlos.</p>
          </div>
          <button type="button" onClick={applySuggested}
            className="text-xs text-violet-600 font-semibold hover:underline whitespace-nowrap flex-shrink-0">
            Aplicar sugeridos
          </button>
        </div>
      )}

      {/* Selector de tipos */}
      <div className="flex flex-wrap gap-2">
        {DELIVERABLE_TYPES.map(dt => {
          const active = value.some(d => d.type === dt.value)
          return (
            <button key={dt.value} type="button"
              onClick={() => active ? remove(dt.value) : addType(dt.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all',
                active
                  ? 'border-violet-500 bg-violet-50 text-violet-700'
                  : 'border-gray-200 text-gray-600 hover:border-violet-300'
              )}>
              <span>{dt.emoji}</span> {dt.label}
            </button>
          )
        })}
      </div>

      {/* Detalle de cada deliverable seleccionado */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map(d => {
            const dt = DELIVERABLE_TYPES.find(t => t.value === d.type)
            return (
              <div key={d.type} className="p-3 rounded-xl border border-violet-100 bg-violet-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-violet-800">
                    {dt?.emoji} {dt?.label ?? d.type}
                  </span>
                  <button type="button" onClick={() => remove(d.type)}
                    className="text-gray-400 hover:text-red-500 text-xs transition-colors">
                    ✕ Quitar
                  </button>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Descripción / brief</label>
                  <textarea value={d.description ?? ''}
                    onChange={e => update(d.type, 'description', e.target.value)}
                    rows={3}
                    placeholder="Ej. Reel de 30 segundos mostrando el producto, mencionar código SCENCE10, tono alegre y dinámico..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white resize-none" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                    <input type="number" min="1" max="50" value={d.quantity}
                      onChange={e => update(d.type, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Fecha entrega</label>
                    <input
                      type="date"
                      value={d.due_date ? d.due_date.split('T')[0] : ''}
                      onChange={e => {
                        const time = d.due_date?.split('T')[1] ?? '23:59'
                        update(d.type, 'due_date', e.target.value ? `${e.target.value}T${time}` : '')
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Hora</label>
                    <input
                      type="time"
                      value={d.due_date?.split('T')[1]?.slice(0, 5) ?? ''}
                      onChange={e => {
                        const date = d.due_date ? d.due_date.split('T')[0] : ''
                        if (date) update(d.type, 'due_date', `${date}T${e.target.value}`)
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {value.length === 0 && (
        <p className="text-xs text-gray-400">
          Selecciona los tipos de entregables que requiere esta campaña.
        </p>
      )}
    </div>
  )
}
