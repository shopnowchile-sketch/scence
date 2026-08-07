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
import { DELIVERABLE_DESCRIPTION_MAX, type DeliverableTemplateItem } from '@/lib/deliverable-templates'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliverableTemplate {
  type: string
  quantity: number
  description?: string
  due_date?: string
  scheduled_at?: string
  items?: DeliverableTemplateItem[]
  tag_brand_ids?: string[]
  tag_handles?: string[]
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

function toLocalDateTimeInput(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

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
  /** Compact configuration used from a campaign overview. */
  compact?: boolean
  taggableBrands?: Array<{ id: string; name: string; instagram?: string | null }>
}

export function DeliverableTemplateBuilder({
  value = [],
  onChange,
  campaignType,
  showSuggestions = true,
  compact = false,
  taggableBrands = [],
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
    onChange(value.map(d => {
      if (d.type !== type) return d
      if (field !== 'quantity') return { ...d, [field]: val }

      const quantity = Math.max(1, Math.min(50, Number(val) || 1))
      const currentItems = d.items ?? Array.from({ length: d.quantity }, () => ({
        description: d.description ?? '',
        due_date: d.due_date ?? '',
        scheduled_at: d.scheduled_at ?? '',
      }))
      const items = Array.from({ length: quantity }, (_, index) => currentItems[index] ?? {
        description: d.description ?? '', due_date: '', scheduled_at: '',
      })
      return { ...d, quantity, items }
    }))
  }

  function updateItem(type: string, index: number, field: keyof DeliverableTemplateItem, val: string) {
    onChange(value.map(d => {
      if (d.type !== type) return d
      const items = d.items ?? Array.from({ length: d.quantity }, () => ({
        description: d.description ?? '', due_date: d.due_date ?? '', scheduled_at: d.scheduled_at ?? '',
      }))
      return { ...d, items: items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: val } : item) }
    }))
  }

  function toggleTagBrand(type: string, brandId: string) {
    onChange(value.map(deliverable => {
      if (deliverable.type !== type) return deliverable
      const selected = new Set(deliverable.tag_brand_ids ?? [])
      if (selected.has(brandId)) selected.delete(brandId)
      else selected.add(brandId)
      return { ...deliverable, tag_brand_ids: Array.from(selected) }
    }))
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
      {!compact && <div className="flex flex-wrap gap-2">
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
      </div>}

      {/* Edición compacta del Overview: conserva los entregables existentes. */}
      {compact && value.length > 0 && (
        <div className="space-y-2">
          {value.map(deliverable => {
            const type = DELIVERABLE_TYPES.find(item => item.value === deliverable.type)
            const selectedBrandIds = new Set(deliverable.tag_brand_ids ?? [])
            return <div key={deliverable.type} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-sm font-semibold text-gray-900">{type?.emoji} {type?.label ?? deliverable.type}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-600">Descripción
                  <textarea value={deliverable.description ?? ''} onChange={event => update(deliverable.type, 'description', event.target.value)} rows={2} placeholder="Instrucciones para este contenido" className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 outline-none focus:border-violet-400" />
                </label>
                <label className="text-xs font-semibold text-gray-600">Fecha límite de publicación
                  <input type="date" value={deliverable.due_date?.split('T')[0] ?? ''} onChange={event => update(deliverable.type, 'due_date', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 outline-none focus:border-violet-400" />
                </label>
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-semibold text-gray-600">Marcas a etiquetar</p>
                {taggableBrands.length ? <div className="flex flex-wrap gap-2">{taggableBrands.map(brand => <button key={brand.id} type="button" onClick={() => toggleTagBrand(deliverable.type, brand.id)} className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors', selectedBrandIds.has(brand.id) ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-500 hover:border-violet-200')}>
                  {selectedBrandIds.has(brand.id) ? '✓ ' : ''}{brand.instagram ? `@${brand.instagram.replace(/^@/, '')}` : brand.name}
                </button>)}</div> : <p className="text-xs text-gray-400">Agrega marcas participantes a la campaña para poder seleccionarlas.</p>}
              </div>
            </div>
          })}
        </div>
      )}

      {/* Detalle completo utilizado en la creación de campaña. */}
      {!compact && value.length > 0 && (
        <div className="space-y-2">
          {value.map(d => {
            const dt = DELIVERABLE_TYPES.find(t => t.value === d.type)
            const items = d.items ?? Array.from({ length: d.quantity }, () => ({
              description: d.description ?? '', due_date: d.due_date ?? '', scheduled_at: d.scheduled_at ?? '',
            }))
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
                <div className="max-w-32">
                  <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                  <input type="number" min="1" max="50" value={d.quantity}
                    onChange={e => update(d.type, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                </div>
                <div>
                  <label className="text-xs text-violet-700 font-semibold mb-1 block">En este {dt?.label ?? d.type} debes colaborar con</label>
                  <input
                    value={(d.tag_handles ?? []).join(', ')}
                    onChange={e => update(d.type, 'tag_handles', e.target.value.split(',').map(handle => handle.trim()).filter(Boolean))}
                    className="w-full border border-violet-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white"
                    placeholder="@marca1, @marca2"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">Estos tags quedarán visibles para la influencer en este entregable.</p>
                </div>

                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={`${d.type}-${index}`} className="rounded-xl border border-violet-200 bg-white p-3 space-y-3">
                      <p className="text-sm font-bold text-violet-700">
                        {dt?.label ?? d.type} {index + 1} de {d.quantity}
                      </p>
                      <div>
                        <div className="flex justify-between gap-3 mb-1">
                          <label className="text-xs text-gray-500">Descripción / brief</label>
                          <span className="text-[11px] text-gray-400">{(item.description ?? '').length} / {DELIVERABLE_DESCRIPTION_MAX}</span>
                        </div>
                        <textarea
                          value={item.description ?? ''}
                          maxLength={DELIVERABLE_DESCRIPTION_MAX}
                          onChange={e => updateItem(d.type, index, 'description', e.target.value)}
                          rows={4}
                          placeholder="Instrucciones específicas para esta pieza..."
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white resize-y"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Fecha límite de entrega</label>
                          <input type="date" value={item.due_date?.split('T')[0] ?? ''}
                            onChange={e => updateItem(d.type, index, 'due_date', e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Publicar el día y hora</label>
                          <input type="datetime-local" value={toLocalDateTimeInput(item.scheduled_at)}
                            onChange={e => updateItem(d.type, index, 'scheduled_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-violet-400 bg-white" />
                        </div>
                      </div>
                    </div>
                  ))}
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
