'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Download, Eye, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { downloadDocumentPdf } from '@/lib/document-pdf'

// ── Paquetes de "SCENCE Launch Experience" ──────────────────────────────────
// Tomados literalmente de la presentación comercial (scence_launch_marcas_.pdf).
// No son inclusiones inventadas: son atajos editables, no una regla fija —
// el Admin puede modificar nombre/monto/inclusiones antes de generar.
const PACKAGE_PRESETS = [
  {
    id: 'basico',
    name: 'Plan Básico · La Escena',
    amount: 100000,
    inclusions: [
      'Presencia de la marca dentro del evento',
      'Inclusión en la comunicación general de marcas',
      'Entrega de productos, muestras o material promocional',
      'Networking con las creadoras asistentes',
      'Contenido orgánico durante el evento',
    ],
  },
  {
    id: 'gold',
    name: 'Plan Gold · Protagonista',
    amount: 350000,
    inclusions: [
      'Presencia de la marca dentro del evento',
      'Inclusión en la comunicación general de marcas',
      'Entrega de productos, muestras o material promocional',
      'Networking con las creadoras asistentes',
      'Contenido orgánico durante el evento',
      'Espacio propio para activación de marca',
      'Activación o experiencia personalizada',
      'Mayor visibilidad dentro del evento',
      'Espacio pensado para generar contenido',
      'Sampling / gifting con las creadoras',
      'Dinámica o experiencia con creadoras',
      'Presencia destacada en la comunicación del evento',
      'Integración de marca en la experiencia SCENCE',
    ],
  },
  {
    id: 'premium',
    name: 'Plan Premium · Ícono',
    amount: undefined as number | undefined, // "A definir" en la presentación — no se inventa un monto.
    inclusions: [
      'Presencia de la marca dentro del evento',
      'Inclusión en la comunicación general de marcas',
      'Entrega de productos, muestras o material promocional',
      'Networking con las creadoras asistentes',
      'Contenido orgánico durante el evento',
      'Espacio propio para activación de marca',
      'Activación o experiencia personalizada',
      'Mayor visibilidad dentro del evento',
      'Espacio pensado para generar contenido',
      'Sampling / gifting con las creadoras',
      'Dinámica o experiencia con creadoras',
      'Presencia destacada en la comunicación del evento',
      'Integración de marca en la experiencia SCENCE',
      'Activación protagonista y ubicación premium',
      'Experiencia diseñada especialmente para la marca',
      'Coordinación personalizada con el equipo SCENCE',
    ],
  },
]

type Template = { id: string; name: string; campaign_type?: string | null; document_type?: string }
type CollaboratorBrand = { id: string; name: string; email?: string | null }
type SavedContract = { id: string; title: string; status: string; content?: string; created_at: string; total_value?: number | null; currency?: string | null; brand?: { name?: string } | null }

export function GenerateContractModal({
  campaignId,
  campaignName,
  campaignType,
  brandId,
  templates,
  collaboratorBrands,
  onClose,
}: {
  campaignId: string
  campaignName: string
  campaignType?: string | null
  brandId?: string | null
  templates: Template[]
  collaboratorBrands: CollaboratorBrand[]
  onClose: () => void
}) {
  const contractTemplates = templates.filter(t => (t.document_type ?? 'contract') === 'contract')
  const [templateId, setTemplateId] = useState('')
  const [partnerBrandId, setPartnerBrandId] = useState('')
  // Datos del evento: precargados desde el booking real cuando existe;
  // editables por el Admin cuando falten o deban corregirse para este
  // contrato en particular. NUNCA se escriben de vuelta en `bookings`.
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventStartTime, setEventStartTime] = useState('')
  const [eventEndTime, setEventEndTime] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [eventFromBooking, setEventFromBooking] = useState(false)
  // Lugares guardados de la marca (brand_locations) — mismo catalogo que el
  // tab "Lugares" de la campana y el picker de "Editar ubicacion". Solo
  // lectura: nunca se escribe aqui, solo se usa para componer eventLocation.
  const [brandLocations, setBrandLocations] = useState<Array<{ id: string; name: string; address: string | null; city: string | null }>>([])
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([])
  const [packageName, setPackageName] = useState('')
  const [packageAmount, setPackageAmount] = useState('')
  const [inclusions, setInclusions] = useState('')
  const [requirements, setRequirements] = useState('')
  const [deliverables, setDeliverables] = useState('')
  const [firstPct, setFirstPct] = useState('50')
  const [firstCondition, setFirstCondition] = useState('before_event')
  const [secondPct, setSecondPct] = useState('50')
  const [secondCondition, setSecondCondition] = useState('after_event')
  const [usagePeriod, setUsagePeriod] = useState('12 meses')
  const [terminationDays, setTerminationDays] = useState('15')
  const [showExtraClauses, setShowExtraClauses] = useState(false)
  const [campaignObjective, setCampaignObjective] = useState('')
  const [primaryResponsibilities, setPrimaryResponsibilities] = useState('')
  const [partnerResponsibilities, setPartnerResponsibilities] = useState('')
  const [billingTerms, setBillingTerms] = useState('')

  const [preview, setPreview] = useState<{ content: string; missing: string[]; missingRequired: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [savedContracts, setSavedContracts] = useState<SavedContract[]>([])
  const [loadingContracts, setLoadingContracts] = useState(true)

  useEffect(() => {
    // Preselección de template si su campaign_type coincide con el de la campaña
    // (contract_templates.campaign_type ya existe — se reutiliza, no se inventa selector nuevo).
    if (!templateId && contractTemplates.length > 0) {
      const match = campaignType ? contractTemplates.find(t => t.campaign_type === campaignType) : undefined
      setTemplateId(match?.id ?? contractTemplates[0].id)
    }
  }, [contractTemplates, campaignType, templateId])

  useEffect(() => {
    // Precarga "Datos del evento" desde el booking real (o campaign.metadata)
    // una sola vez, sin tocar `preview` ni disparar el flujo de Vista previa.
    // Reutiliza el mismo endpoint (dry_run) — no hay endpoint nuevo.
    if (!templateId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId, template_id: templateId, partner_brand_id: partnerBrandId || null, dry_run: true }),
        })
        const json = await res.json()
        if (cancelled || !res.ok) return
        const defaults = json.data?.meta?.event_defaults as { name?: string; date?: string; startTime?: string; endTime?: string; location?: string } | undefined
        if (!defaults) return
        setEventFromBooking(Boolean(defaults.name || defaults.date || defaults.location))
        setEventName(prev => prev || defaults.name || '')
        setEventDate(prev => prev || defaults.date || '')
        setEventStartTime(prev => prev || defaults.startTime || '')
        setEventEndTime(prev => prev || defaults.endTime || '')
        setEventLocation(prev => prev || defaults.location || '')
      } catch {
        // Silencioso: si falla, el Admin simplemente completa los campos a mano.
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, templateId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingContracts(true)
      try {
        const res = await fetch(`/api/contracts?campaign_id=${campaignId}`)
        const json = await res.json()
        if (!cancelled && res.ok) setSavedContracts(Array.isArray(json.data) ? json.data : [])
      } finally {
        if (!cancelled) setLoadingContracts(false)
      }
    })()
    return () => { cancelled = true }
  }, [campaignId])

  useEffect(() => {
    // Mismo endpoint que ya usa el tab "Lugares" de la campana
    // (GET /api/brands/[id]/locations) — no hay endpoint nuevo.
    if (!brandId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/locations`)
        const json = await res.json()
        if (!cancelled && res.ok) setBrandLocations(Array.isArray(json.data) ? json.data : [])
      } catch {
        // Silencioso: sin catalogo el campo de texto sigue funcionando a mano.
      }
    })()
    return () => { cancelled = true }
  }, [brandId])

  // Recalcula el texto de "Lugar / direccion" a partir de los lugares
  // marcados. El campo de texto sigue editable despues — esto solo compone
  // un punto de partida, nunca sobreescribe una edicion manual en curso salvo
  // que el propio checkbox cambie.
  function toggleLocationSelection(locationId: string) {
    setSelectedLocationIds(previous => {
      const next = previous.includes(locationId)
        ? previous.filter(id => id !== locationId)
        : [...previous, locationId]
      const composed = next
        .map(id => brandLocations.find(loc => loc.id === id))
        .filter((loc): loc is NonNullable<typeof loc> => Boolean(loc))
        .map(loc => [loc.name, [loc.address, loc.city].filter(Boolean).join(', ')].filter(Boolean).join(' — '))
        .join(' / ')
      setEventLocation(composed)
      return next
    })
  }

  function applyPreset(preset: typeof PACKAGE_PRESETS[number]) {
    setPackageName(preset.name)
    setPackageAmount(preset.amount ? String(preset.amount) : '')
    setInclusions(preset.inclusions.join('\n'))
  }

  function buildPayload(dryRun: boolean) {
    const amountNum = packageAmount ? Number(packageAmount) : undefined
    return {
      campaign_id: campaignId,
      template_id: templateId,
      partner_brand_id: partnerBrandId || null,
      event: {
        name: eventName.trim() || undefined,
        date: eventDate || undefined,
        start_time: eventStartTime || undefined,
        end_time: eventEndTime || undefined,
        location: eventLocation.trim() || undefined,
      },
      package: {
        name: packageName || undefined,
        amount: amountNum,
        currency: 'CLP',
        inclusions: inclusions.split('\n').map(l => l.trim()).filter(Boolean),
        requirements: requirements.split('\n').map(l => l.trim()).filter(Boolean),
        deliverables: deliverables.split('\n').map(l => l.trim()).filter(Boolean),
      },
      payment: (firstPct && secondPct) ? {
        first_percentage: Number(firstPct),
        first_condition: firstCondition,
        second_percentage: Number(secondPct),
        second_condition: secondCondition,
      } : undefined,
      usage_period: usagePeriod || undefined,
      termination_notice_days: terminationDays || undefined,
      campaign_objective: campaignObjective || undefined,
      primary_brand_responsibilities: primaryResponsibilities || undefined,
      partner_brand_responsibilities: partnerResponsibilities || undefined,
      billing_terms: billingTerms || undefined,
      dry_run: dryRun,
    }
  }

  async function handlePreview() {
    if (!templateId) { toast.error('Selecciona una plantilla'); return }
    setPreviewing(true)
    setPreview(null)
    try {
      const res = await fetch('/api/contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload(true)) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error generando la vista previa')
      setPreview({ content: json.data.content, missing: json.data.missing ?? [], missingRequired: json.data.missing_required ?? [] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleGenerate() {
    if (!templateId) { toast.error('Selecciona una plantilla'); return }
    // El backend es la autoridad final: aunque el botón ya está deshabilitado
    // mientras haya missing_required, si de todas formas llega un 422 (por
    // ejemplo un preview desactualizado), se refleja acá en vez de guardar.
    setGenerating(true)
    try {
      const res = await fetch('/api/contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload(false)) })
      const json = await res.json()
      if (!res.ok) {
        if (json.missing_required?.length) {
          setPreview(prev => prev ? { ...prev, missingRequired: json.missing_required } : prev)
          throw new Error(`${json.error ?? 'Faltan datos obligatorios'}: ${json.missing_required.join(', ')}`)
        }
        throw new Error(json.error ?? 'Error al generar el contrato')
      }
      toast.success('Contrato generado y guardado')
      setSavedContracts(prev => [{ ...json.data }, ...prev])
      setPreview(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setGenerating(false)
    }
  }

  async function handleViewSaved(contractId: string) {
    try {
      const res = await fetch(`/api/contracts/${contractId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el contrato')
      setPreview({ content: json.data.content, missing: (json.data.metadata?.generated_missing_fields as string[] | undefined) ?? [], missingRequired: [] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    }
  }

  async function handleDownloadPdf(contract: SavedContract) {
    let content = contract.content
    if (!content) {
      const res = await fetch(`/api/contracts/${contract.id}`)
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'No se pudo cargar el contrato'); return }
      content = json.data.content
    }
    await downloadDocumentPdf({
      title: contract.title,
      content_snapshot: content ?? '',
      status: contract.status,
      signer_name: null, signer_rut: null, signer_role: null, signer_email: null, signed_at: null,
      due_at: contract.created_at,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/40 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Generar contrato de campaña</h2>
            <p className="text-xs text-gray-400 mt-0.5">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {contractTemplates.length === 0 ? (
            <div className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
              No hay plantillas de tipo &quot;contrato&quot;. Crea una en <a href="/admin-contracts" className="text-violet-600 font-semibold hover:underline">Admin → Contratos</a>.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Plantilla</label>
                  <select className="input-base" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                    {contractTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Marca colaboradora</label>
                  <select className="input-base" value={partnerBrandId} onChange={e => setPartnerBrandId(e.target.value)}>
                    <option value="">— Sin marca colaboradora —</option>
                    {collaboratorBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {collaboratorBrands.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">Esta campaña no tiene marcas colaboradoras asignadas (campaign_brands).</p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-xs font-semibold text-gray-600">Datos del evento</label>
                  {eventFromBooking && (
                    <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Precargado desde el booking real</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  Estos datos pertenecen solo a este contrato — no modifican el booking real de la campaña. Si el booking no tiene un dato, complétalo aquí.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Nombre del evento</label>
                    <input className="input-base" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Ej: SCENCE Launch Experience" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Fecha</label>
                    <input className="input-base" type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Hora inicio</label>
                      <input className="input-base" type="time" value={eventStartTime} onChange={e => setEventStartTime(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Hora término</label>
                      <input className="input-base" type="time" value={eventEndTime} onChange={e => setEventEndTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="col-span-2">
                    {brandLocations.length > 0 && (
                      <div className="mb-2">
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Lugar(es) de la marca</label>
                        <div className="flex flex-wrap gap-1.5">
                          {brandLocations.map(loc => (
                            <label key={loc.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50/60 px-2 py-1 text-xs font-medium text-violet-800">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                                checked={selectedLocationIds.includes(loc.id)}
                                onChange={() => toggleLocationSelection(loc.id)}
                              />
                              {loc.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Lugar / dirección</label>
                    <input className="input-base" value={eventLocation} onChange={e => setEventLocation(e.target.value)} placeholder="Ej: Av. Presidente Kennedy 5741, Las Condes" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Paquete — atajos desde la presentación comercial</label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PACKAGE_PRESETS.map(preset => (
                    <button key={preset.id} type="button" onClick={() => applyPreset(preset)}
                      className="text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-md px-2.5 py-1 font-semibold hover:bg-violet-100 transition-colors">
                      {preset.name}{preset.amount ? ` · $${preset.amount.toLocaleString('es-CL')}` : ' · monto a definir'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Nombre del paquete</label>
                    <input className="input-base" value={packageName} onChange={e => setPackageName(e.target.value)} placeholder="Ej: Plan Gold · Protagonista" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Monto (CLP)</label>
                    <input className="input-base" type="number" value={packageAmount} onChange={e => setPackageAmount(e.target.value)} placeholder="350000" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 mt-3">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Inclusiones (una por línea)</label>
                    <textarea className="input-base font-mono text-xs" rows={4} value={inclusions} onChange={e => setInclusions(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Requisitos (una por línea)</label>
                    <textarea className="input-base font-mono text-xs" rows={2} value={requirements} onChange={e => setRequirements(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Entregables (una por línea)</label>
                    <textarea className="input-base font-mono text-xs" rows={2} value={deliverables} onChange={e => setDeliverables(e.target.value)} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Condiciones de pago</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex gap-2 items-center">
                    <input className="input-base w-20" type="number" value={firstPct} onChange={e => setFirstPct(e.target.value)} />
                    <span className="text-xs text-gray-400">%</span>
                    <select className="input-base flex-1" value={firstCondition} onChange={e => setFirstCondition(e.target.value)}>
                      <option value="before_event">antes del evento</option>
                      <option value="on_signing">a la firma</option>
                      <option value="after_event">después del evento</option>
                      <option value="on_publish">al publicar</option>
                    </select>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input className="input-base w-20" type="number" value={secondPct} onChange={e => setSecondPct(e.target.value)} />
                    <span className="text-xs text-gray-400">%</span>
                    <select className="input-base flex-1" value={secondCondition} onChange={e => setSecondCondition(e.target.value)}>
                      <option value="after_event">después del evento</option>
                      <option value="before_event">antes del evento</option>
                      <option value="on_signing">a la firma</option>
                      <option value="on_publish">al publicar</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <button type="button" onClick={() => setShowExtraClauses(v => !v)} className="text-xs font-semibold text-violet-600 hover:underline">
                  {showExtraClauses ? 'Ocultar' : 'Mostrar'} cláusulas adicionales (objetivo, responsabilidades, facturación)
                </button>
                {showExtraClauses && (
                  <div className="grid grid-cols-1 gap-3 mt-3">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Objetivo de la colaboración (si se omite, se usa la descripción de la campaña)</label>
                      <textarea className="input-base text-xs" rows={2} value={campaignObjective} onChange={e => setCampaignObjective(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Responsabilidades de la Marca Principal</label>
                      <textarea className="input-base text-xs" rows={2} value={primaryResponsibilities} onChange={e => setPrimaryResponsibilities(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Responsabilidades de la marca colaboradora</label>
                      <textarea className="input-base text-xs" rows={2} value={partnerResponsibilities} onChange={e => setPartnerResponsibilities(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Forma de facturación</label>
                      <input className="input-base text-xs" value={billingTerms} onChange={e => setBillingTerms(e.target.value)} placeholder="Ej: factura emitida por SCENCE SpA al finalizar el evento" />
                    </div>
                  </div>
                )}
              </div>

              {preview && (
                <div className="space-y-2">
                  {preview.missingRequired.length > 0 && (
                    <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">Obligatorios faltantes — no se puede generar todavía:</span>{' '}
                        <span className="font-mono">{preview.missingRequired.join(', ')}</span>
                      </span>
                    </div>
                  )}
                  {preview.missing.filter(key => !preview.missingRequired.includes(key)).length > 0 && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      <span>Opcionales sin completar: <span className="font-mono">{preview.missing.filter(key => !preview.missingRequired.includes(key)).join(', ')}</span>. Aparecerán como &quot;________________&quot; en el contrato.</span>
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap text-xs text-gray-700 leading-relaxed font-sans bg-gray-50 rounded-xl p-4 border border-gray-100 max-h-[40vh] overflow-y-auto">{preview.content}</pre>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={handlePreview} disabled={previewing}
                  className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Vista previa real
                </button>
                <button type="button" onClick={handleGenerate} disabled={generating || !preview || preview.missingRequired.length > 0}
                  title={!preview ? 'Corre "Vista previa real" primero' : preview.missingRequired.length > 0 ? 'Completa los campos obligatorios marcados en rojo' : undefined}
                  className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generar y guardar
                </button>
              </div>
            </>
          )}

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-semibold text-gray-600 mb-2">Contratos generados de esta campaña</h3>
            {loadingContracts ? (
              <p className="text-xs text-gray-400">Cargando…</p>
            ) : savedContracts.length === 0 ? (
              <p className="text-xs text-gray-400">Sin contratos generados todavía.</p>
            ) : (
              <div className="space-y-2">
                {savedContracts.map(c => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.title}</p>
                      <p className="text-[11px] text-gray-400">{c.brand?.name ?? 'Sin marca colaboradora'} · {new Date(c.created_at).toLocaleDateString('es-CL')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleViewSaved(c.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:underline"><Eye className="h-3.5 w-3.5" />Ver</button>
                      <button onClick={() => handleDownloadPdf(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:underline"><Download className="h-3.5 w-3.5" />PDF</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
