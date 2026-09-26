'use client'

import { useState, useRef, useEffect } from 'react'
import { InstagramSyncHint, hideUnconfirmedZero } from '@/components/influencers/InstagramSyncHint'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft, Star, MapPin, Mail, Phone,
  CheckCircle2, ExternalLink, Edit2, Users, TrendingUp,
  DollarSign, Calendar, FileText, Clock, AlertCircle, Loader2, Trash2, UserX, RefreshCw, Download, Shield, LockKeyhole,
} from 'lucide-react'
import { formatCurrency, formatDate, formatFollowers, getInitials, PLATFORM_ICONS, PLATFORM_LABELS, cn } from '@/lib/utils'
import type { SocialProfile, RateCard, CampaignInfluencerJoin, DeliverableJoin, InfluencerDetail } from '@/types'
import { AddressWithMap } from '@/components/maps/GoogleMap'
import { useInfluencer } from '@/hooks/useInfluencersList'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ProSubscriptionSection } from '@/components/subscription/ProSubscriptionSection'

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildProfileUrl(platform: string, username: string | null): string | null {
  if (!username) return null
  const u = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram': return `https://instagram.com/${u}`
    case 'tiktok':    return `https://tiktok.com/@${u}`
    case 'youtube':   return `https://youtube.com/@${u}`
    case 'twitter':   return `https://twitter.com/${u}`
    case 'facebook':  return `https://facebook.com/${u}`
    case 'linkedin':  return `https://linkedin.com/in/${u}`
    default:          return null
  }
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────
function AdminInfluencerDocuments({ influencerId }: { influencerId: string }) {
  const [documents, setDocuments] = useState<Array<{
    id: string
    document_title: string
    document_version: string
    status: string
    accepted_at: string
    influencer_name?: string | null
  }>>([])
  const [uploads, setUploads] = useState<Array<{
    id: string
    title: string
    original_filename: string
    file_size: number
    mime_type: string
    created_at: string
  }>>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<{ url: string; name: string; mimeType: string } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [termsResponse, documentsResponse] = await Promise.all([
          fetch('/api/admin/subscription-payments?influencer_id=' + encodeURIComponent(influencerId), { cache: 'no-store' }),
          fetch('/api/admin/influencer-documents?influencer_id=' + encodeURIComponent(influencerId), { cache: 'no-store' }),
        ])
        const [termsResult, documentsResult] = await Promise.all([termsResponse.json(), documentsResponse.json()])
        if (!termsResponse.ok) throw new Error(termsResult.error ?? 'No se pudieron cargar los T&C.')
        if (!documentsResponse.ok) throw new Error(documentsResult.error ?? 'No se pudieron cargar los documentos.')
        setDocuments(termsResult.terms_acceptances ?? [])
        setUploads(documentsResult.data ?? [])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los documentos.')
      } finally {
        setLoading(false)
      }
    })()
  }, [influencerId])

  async function openUpload(documentId: string) {
    const response = await fetch('/api/admin/influencer-documents?id=' + encodeURIComponent(documentId), { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) return toast.error(result.error ?? 'No se pudo abrir el documento.')
    setPreview({ url: result.url, name: result.original_filename ?? 'Documento', mimeType: result.mime_type ?? 'application/octet-stream' })
  }

  if (loading) return <div className="card p-6 text-center text-sm text-gray-400">Cargando documentos…</div>

  const total = uploads.length + documents.length

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-bold text-gray-900">Documentos</h3>
        <p className="mt-1 text-xs text-gray-400">{total === 0 ? 'No hay documentos registrados.' : `${total} documento${total === 1 ? '' : 's'}`}</p>
      </div>

      {total === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-gray-400">La influencer todavía no ha subido documentos ni aceptado T&C.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {uploads.map(document => (
            <div key={document.id} className="flex items-center gap-3 px-5 py-4">
              <FileText className="h-5 w-5 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{document.title}</p>
                <p className="truncate text-xs text-gray-400">{document.original_filename} · {(document.file_size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button type="button" onClick={() => void openUpload(document.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50" title="Ver documento">
                Ver
              </button>
            </div>
          ))}

          {documents.map(document => (
            <div key={document.id} className="flex items-center gap-3 px-5 py-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{document.document_title}</p>
                <p className="text-xs text-gray-400">Versión {document.document_version} · Aceptado {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(document.accepted_at))}</p>
              </div>
              <a href={'/api/admin/influencer-terms/' + document.id + '/pdf'} download className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                <Download className="h-3.5 w-3.5" /> PDF
              </a>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setPreview(null)}>
          <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="truncate pr-4 text-sm font-semibold text-gray-900">{preview.name}</p>
              <div className="flex items-center gap-2">
                <a href={preview.url} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">Abrir</a>
                <button type="button" onClick={() => setPreview(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100">Cerrar</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-gray-100 p-2">
              {preview.mimeType === 'application/pdf' ? (
                <iframe src={preview.url} title={preview.name} className="h-full w-full rounded-lg bg-white" />
              ) : preview.mimeType.startsWith('image/') ? (
                <div className="flex h-full items-center justify-center overflow-auto"><img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /></div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">Este formato no permite vista previa. Usa “Abrir”.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NotesTab({ id, notes }: { id: string; notes: string | null }) {
  const [editing, setEditing]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [value,   setValue]     = useState(notes ?? '')
  const qc = useQueryClient()
  const ref = useRef<HTMLTextAreaElement>(null)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/influencers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await qc.invalidateQueries({ queryKey: ['influencer', id] })
      toast.success('Notas guardadas')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function startEditing() {
    setEditing(true)
    setTimeout(() => ref.current?.focus(), 50)
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900">Notas internas</h3>
        {!editing && (
          <button onClick={startEditing}
            className="flex items-center gap-1.5 text-sm text-violet-600 hover:underline font-medium">
            <Edit2 className="h-3.5 w-3.5" /> {notes ? 'Editar' : 'Agregar nota'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            ref={ref}
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={6}
            className="input-base w-full resize-none"
            placeholder="Agrega contexto interno sobre este influencer: historial, notas de negociación, preferencias, etc."
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setValue(notes ?? '') }}
              className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Guardar
            </button>
          </div>
        </div>
      ) : notes ? (
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-4">
          {notes}
        </p>
      ) : (
        <div className="text-center py-12">
          <FileText className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Sin notas. Agrega contexto interno sobre este influencer.</p>
          <button onClick={startEditing} className="mt-4 text-sm text-violet-600 font-medium hover:underline">
            + Agregar nota
          </button>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const GRADIENTS = [
  'from-pink-400 to-violet-500', 'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500', 'from-orange-400 to-red-500',
]

const DELIVERABLE_STATUS: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  pending:   { label: 'Pendiente',   cls: 'badge-gray',   icon: AlertCircle },
  in_review: { label: 'En revisión', cls: 'badge-orange', icon: Clock },
  approved:  { label: 'Aprobado',    cls: 'badge-blue',   icon: CheckCircle2 },
  rejected:  { label: 'Rechazado',   cls: 'badge-red',    icon: AlertCircle },
  published: { label: 'Publicado',   cls: 'badge-green',  icon: CheckCircle2 },
}

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  active:    'badge-green',
  completed: 'badge-gray',
  draft:     'badge-gray',
  paused:    'badge-orange',
  canceled:  'badge-red',
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function InfluencerProfile({ id }: { id: string }) {
  const [tab, setTab] = useState<'overview' | 'plan' | 'campaigns' | 'deliverables' | 'history' | 'documents' | 'notes'>('overview')
  const [removingCi, setRemovingCi] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deletingHard, setDeletingHard] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [syncingIg, setSyncingIg] = useState(false)
  const [changingPro, setChangingPro] = useState(false)
  const { data: res, isLoading, error, refetch } = useInfluencer(id)
  const { isAdmin } = useIsAdmin()
  const router = useRouter()
  const searchParams = useSearchParams()
  const backHref = searchParams.get('from') || '/admin-influencers'

  async function handleManualPro(active: boolean) {
    setChangingPro(true)
    try {
      const response = await fetch(`/api/influencers/${id}/pro`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      await refetch()
      toast.success(active ? 'Plan Pro manual activado.' : 'Plan Pro manual retirado.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el plan.')
    } finally {
      setChangingPro(false)
    }
  }

  async function handleStatusChange(newStatus: 'draft' | 'active' | 'inactive') {
    setDeactivating(true)
    try {
      const patch: Record<string, unknown> = {}
      if (newStatus === 'draft')     { patch.is_active = false; patch.status = 'draft' }
      if (newStatus === 'active')    { patch.is_active = true;  patch.status = 'active' }
      if (newStatus === 'inactive')  { patch.is_active = false; patch.status = 'inactive' }
      const r = await fetch(`/api/influencers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Error al cambiar estado')
      toast.success(`Estado actualizado a ${newStatus}`)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar estado')
    } finally {
      setDeactivating(false)
    }
  }

  async function handleDeletePermanent() {
    if (!confirm(`¿ELIMINAR PERMANENTEMENTE a este influencer? Se borrarán también sus redes, tarifas y vínculos con campañas. Esta acción NO se puede deshacer.`)) return
    setDeletingHard(true)
    try {
      const r = await fetch(`/api/influencers/${id}?hard=true`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Error al eliminar')
      toast.success('Influencer eliminado permanentemente')
      router.push('/admin-influencers')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      setDeletingHard(false)
    }
  }

  async function handleInvite() {
    if (!influencer.email) {
      toast.error('El influencer no tiene email. Agrega uno antes de invitar.')
      return
    }
    const already = !!influencer.user_id
    if (!confirm(already
      ? `¿Generar nuevo link de acceso para ${influencer.email}?`
      : `¿Invitar a ${influencer.email} al portal de influencers?`
    )) return
    setInviting(true)
    try {
      const r = await fetch(`/api/influencers/${id}/invite`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Error al invitar')

      if (j.email_sent) {
        toast.success(`✅ Email enviado a ${influencer.email}`)
      } else if (j.email_sent === false) {
        toast.error(j.message ?? 'No se pudo enviar el email', { duration: 10000 })
      } else {
        toast.success(j.message ?? 'Listo')
      }

      if (!already) refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al invitar')
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveFromCampaign(ciId: string, campaignId: string, campaignName: string) {
    if (!confirm(`¿Sacar a este influencer de la campaña "${campaignName}"? Se perderá su fee y deliverables en esa campaña.`)) return
    setRemovingCi(ciId)
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/influencers?influencer_id=${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json()
        throw new Error(j.error ?? 'Error al eliminar')
      }
      toast.success('Influencer removido de la campaña')
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setRemovingCi(null)
    }
  }

  async function handleSyncInstagram() {
    setSyncingIg(true)
    try {
      // Meta Business Discovery vía la función central (síncrono, sin polling).
      const res = await fetch('/api/influencers/sync-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencer_ids: [id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo sincronizar Instagram')
      if (json.message) toast.info(json.message)
      else if (Number(json.synced ?? 0) > 0) toast.success('Instagram actualizado')
      else if (Number(json.not_found ?? 0) > 0) toast.warning('No sincronizable: la cuenta es personal o el @ no existe. Revisa el @ o pide que la cambie a cuenta Creador.')
      else throw new Error(json.errors?.[0] ?? 'Instagram no respondió; se reintentará automáticamente')
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al sincronizar Instagram')
      refetch()
    } finally {
      setSyncingIg(false)
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
          <ChevronLeft className="h-4 w-4" /> Influencers
        </Link>
        <div className="card p-6 flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
        </div>
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error || !res?.data) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
          <ChevronLeft className="h-4 w-4" /> Influencers
        </Link>
        <div className="card p-12 text-center">
          <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Influencer no encontrado</p>
          <Link href={backHref} className="mt-4 inline-block text-sm text-violet-600 hover:underline">
            Volver al roster
          </Link>
        </div>
      </div>
    )
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  const influencer = res.data as InfluencerDetail
  const socialProfiles: SocialProfile[] = influencer.social_profiles ?? []
  const rateCards: RateCard[] = (influencer.rate_cards ?? []).filter(rc => rc.is_active !== false)
  const campaignInfluencers: CampaignInfluencerJoin[] = influencer.campaign_influencers ?? []
  const deliverables: DeliverableJoin[] = influencer.campaign_deliverables ?? []
  const barters = influencer.barters ?? []
  const bookings = influencer.bookings ?? []
  const conversions = influencer.affiliate_conversions ?? []
  const settlements = influencer.commission_settlements ?? []

  const avatarGrad = GRADIENTS[influencer.display_name.charCodeAt(0) % GRADIENTS.length]
  const initials = getInitials(influencer.display_name)

  const totalFollowers = socialProfiles.reduce((s, sp) => s + (sp.followers ?? 0), 0)
  const avgEngagement = socialProfiles.length
    ? socialProfiles.reduce((s, sp) => s + (sp.engagement_rate ?? 0), 0) / socialProfiles.length
    : 0
  const activeCampaigns = campaignInfluencers.filter(ci => ci.campaign?.status === 'active').length
  const totalEarnings = campaignInfluencers.reduce((s, ci) => s + (ci.fee ?? 0), 0)
  const orderedCampaignInfluencers = [...campaignInfluencers].sort((a, b) => {
    const statusRank = (status: string | null | undefined) => status === 'completed' || status === 'canceled' ? 1 : 0
    const rankDiff = statusRank(a.campaign?.status) - statusRank(b.campaign?.status)
    if (rankDiff !== 0) return rankDiff
    const aDate = a.campaign?.start_date ? new Date(a.campaign.start_date).getTime() : Number.MAX_SAFE_INTEGER
    const bDate = b.campaign?.start_date ? new Date(b.campaign.start_date).getTime() : Number.MAX_SAFE_INTEGER
    return aDate - bDate
  })

  const history = [
    ...campaignInfluencers.flatMap(ci => ci.created_at ? [{
      id: `campaign-${ci.id}`,
      date: ci.created_at,
      icon: '📣',
      title: 'Asignada a campaña',
      detail: ci.campaign?.name ?? 'Campaña',
      href: ci.campaign?.id ? `/admin-campaigns/${ci.campaign.id}` : null,
    }] : []),
    ...deliverables.flatMap(d => {
      const events: Array<{ id: string; date: string; icon: string; title: string; detail: string; href: string | null }> = []
      const href = d.campaign?.id ? `/admin-campaigns/${d.campaign.id}?tab=deliverables` : null
      const detail = `${d.title || d.type || 'Entregable'} · ${d.campaign?.name ?? 'Campaña'}`
      if (d.created_at) events.push({ id: `deliverable-created-${d.id}`, date: d.created_at, icon: '📝', title: 'Entregable creado', detail, href })
      if (d.submitted_at) events.push({ id: `deliverable-submitted-${d.id}`, date: d.submitted_at, icon: '📤', title: 'Entregable enviado', detail, href })
      if (d.published_at) events.push({ id: `deliverable-published-${d.id}`, date: d.published_at, icon: '✅', title: 'Contenido publicado', detail, href })
      if (d.attendance_outcome === 'no_show' && d.attendance_outcome_at) {
        events.push({
          id: `attendance-no-show-${d.id}`,
          date: d.attendance_outcome_at,
          icon: '🔴',
          title: 'No asistió',
          detail: `${d.attendance_note ?? 'No asistió'} · ${d.campaign?.name ?? 'Campaña'}`,
          href: d.campaign?.id ? `/admin-campaigns/${d.campaign.id}?tab=influencers` : null,
        })
      }
      return events
    }),
    ...barters.flatMap(barter => {
      const href = barter.campaign?.id ? `/admin-campaigns/${barter.campaign.id}?tab=canjes` : null
      const detail = `${barter.item} · ${barter.campaign?.name ?? 'Canje'}`
      const events = [{ id: `barter-created-${barter.id}`, date: barter.created_at, icon: '🎁', title: 'Canje registrado', detail, href }]
      if (barter.completed_at) events.push({ id: `barter-completed-${barter.id}`, date: barter.completed_at, icon: '✅', title: 'Canje completado', detail, href })
      return events
    }),
    ...bookings.map(booking => ({
      id: `booking-${booking.id}`,
      date: booking.starts_at,
      icon: '📅',
      title: booking.canceled_at ? 'Reserva cancelada' : 'Acción programada',
      detail: `${booking.title} · ${booking.campaign?.name ?? 'Sin campaña'}`,
      href: booking.campaign?.id ? `/admin-campaigns/${booking.campaign.id}?tab=locations` : null,
    })),
    ...conversions.map(conversion => ({
      id: `conversion-${conversion.id}`,
      date: conversion.confirmed_at ?? conversion.occurred_at,
      icon: '🛒',
      title: conversion.status === 'confirmed' ? 'Venta afiliada confirmada' : conversion.status === 'cancelled' ? 'Venta afiliada cancelada' : 'Venta afiliada pendiente',
      detail: `${formatCurrency(conversion.sale_amount, conversion.currency)} · Comisión ${formatCurrency(conversion.commission_amount, conversion.currency)}${conversion.campaign?.name ? ` · ${conversion.campaign.name}` : ''}`,
      href: conversion.campaign?.id ? `/admin-campaigns/${conversion.campaign.id}` : null,
    })),
    ...settlements.map(settlement => ({
      id: `settlement-${settlement.id}`,
      date: settlement.paid_at ?? settlement.created_at,
      icon: '💳',
      title: settlement.status === 'paid' ? 'Comisión pagada' : settlement.status === 'problem' ? 'Comisión con problema' : 'Comisión pendiente de pago',
      detail: `${formatCurrency(settlement.amount, settlement.currency)}${settlement.campaign?.name ? ` · ${settlement.campaign.name}` : ''}`,
      href: settlement.campaign?.id ? `/admin-campaigns/${settlement.campaign.id}?tab=billing` : null,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <Link href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
        <ChevronLeft className="h-4 w-4" /> Influencers
      </Link>

      {/* Status banner */}
      {!influencer.is_active && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="text-base">
            {(influencer.metadata as Record<string,unknown>)?.status === 'draft' ? '📋' : '⚠️'}
          </span>
          <div>
            <span className="font-semibold">
              {(influencer.metadata as Record<string,unknown>)?.status === 'draft'
                ? 'Influencer en Draft — no visible en campañas activas.'
                : 'Influencer Inactiva.'}
            </span>
            {(() => {
              const reason = influencer.metadata?.deactivation_reason
              return reason ? <span className="ml-1">Razón: {String(reason)}</span> : null
            })()}
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {influencer.avatar_url ? (
              <img src={influencer.avatar_url} alt={influencer.display_name}
                className="w-20 h-20 rounded-2xl object-cover" />
            ) : (
              <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${avatarGrad} flex items-center justify-center`}>
                <span className="text-white text-2xl font-black">{initials}</span>
              </div>
            )}
            {influencer.is_verified && (
              <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-white" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                    {influencer.display_name}
                  </h1>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-extrabold', influencer.pro_source === 'manual' ? 'bg-amber-100 text-amber-800' : influencer.is_pro ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600')}>
                    {influencer.is_pro ? 'PLAN PRO' : 'PLAN GRATIS'}
                  </span>
                  {!influencer.is_active && (
                    <span className={`badge text-xs ${
                      (influencer.metadata as Record<string,unknown>)?.status === 'draft'
                        ? 'badge-gray' : 'badge-red'
                    }`}>
                      {(influencer.metadata as Record<string,unknown>)?.status === 'draft' ? 'Draft' : 'Inactiva'}
                    </span>
                  )}
                </div>

                {/* Social handles */}
                {socialProfiles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 mt-1.5">
                    {socialProfiles.map(sp => {
                      const url = sp.profile_url || buildProfileUrl(sp.platform, sp.username)
                      const label = sp.username ? `@${sp.username}` : (PLATFORM_LABELS[sp.platform] ?? sp.platform)
                      return (
                        <a key={sp.id} href={url ?? '#'} target={url ? '_blank' : undefined} rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-violet-600 hover:text-violet-800 font-medium transition-colors">
                          <span>{PLATFORM_ICONS[sp.platform]}</span>
                          <span>{label}</span>
                          {url && <ExternalLink className="h-3 w-3" />}
                        </a>
                      )
                    })}
                  </div>
                )}

                {/* Location + contact */}
                <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-400">
                  {(influencer.commune || influencer.city || influencer.country) && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {[influencer.commune, influencer.city, influencer.country].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {influencer.address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-gray-300" />
                      {influencer.address as string}
                    </span>
                  )}
                  {influencer.birth_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-gray-300" />
                      {formatDate(influencer.birth_date, 'd MMM yyyy')}
                    </span>
                  )}
                  {influencer.email && (
                    <a href={`mailto:${influencer.email}`} className="flex items-center gap-1 hover:text-violet-600 transition-colors">
                      <Mail className="h-3.5 w-3.5" />
                      {influencer.email}
                    </a>
                  )}
                  {influencer.phone && (
                    <a href={`tel:${influencer.phone}`} className="flex items-center gap-1 hover:text-violet-600 transition-colors">
                      <Phone className="h-3.5 w-3.5" />
                      {influencer.phone}
                    </a>
                  )}
                </div>

                {/* Categories */}
                {(influencer.categories ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(influencer.categories ?? []).map(cat => (
                      <span key={cat} className="badge badge-gray capitalize text-xs">{cat}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(influencer.rating ?? 0) > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 rounded-lg border border-amber-100 mr-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span className="text-xs font-bold text-amber-700">{(influencer.rating as number).toFixed(1)}</span>
                  </div>
                )}

                {/* Edit */}
                <Link href={`/admin-influencers/${id}/edit`}
                  title="Editar influencer"
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500">
                  <Edit2 className="h-4 w-4" />
                </Link>

                {/* Sync Instagram */}
                {socialProfiles.some(sp => sp.platform === 'instagram') && (
                  <button onClick={handleSyncInstagram} disabled={syncingIg}
                    title="Sincronizar seguidores desde Instagram"
                    className="p-2 rounded-lg border border-gray-200 hover:bg-pink-50 hover:border-pink-200 hover:text-pink-600 transition-colors text-gray-500 disabled:opacity-50">
                    {syncingIg ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                )}

                {/* Invite to portal */}
                {influencer.email && (
                  <button onClick={handleInvite} disabled={inviting}
                    title={influencer.user_id ? 'Reenviar invitación al portal' : 'Invitar al portal de influencer'}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-600 transition-colors text-gray-500 disabled:opacity-50">
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  </button>
                )}

                {/* Estado */}
                <div className="relative flex items-center">
                  {deactivating && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 absolute -left-5" />}
                  <select
                    value={(influencer.metadata as Record<string,unknown>)?.status as string ?? (influencer.is_active === false ? 'inactive' : 'active')}
                    onChange={e => handleStatusChange(e.target.value as 'draft' | 'active' | 'inactive')}
                    disabled={deactivating}
                    className={cn(
                      'text-xs font-semibold rounded-lg px-2.5 py-1.5 border cursor-pointer outline-none appearance-none pr-6',
                      ((influencer.metadata as Record<string,unknown>)?.status ?? (influencer.is_active !== false ? 'active' : 'inactive')) === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : ((influencer.metadata as Record<string,unknown>)?.status) === 'draft'
                        ? 'bg-gray-100 text-gray-600 border-gray-200'
                        : 'bg-red-50 text-red-600 border-red-200'
                    )}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>

                {/* Delete — solo admin, icono basura discreto */}
                {isAdmin && (
                  <button onClick={handleDeletePermanent} disabled={deletingHard}
                    title="Eliminar permanentemente"
                    className="p-2 rounded-lg border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors text-gray-400 disabled:opacity-50 ml-1">
                    {deletingHard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className={cn('grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-gray-100', totalEarnings > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
          {[
            { icon: Users,      color: 'violet',  label: 'Seguidores totales', value: formatFollowers(totalFollowers) },
            { icon: TrendingUp, color: 'blue',    label: 'Engagement prom.',   value: `${avgEngagement.toFixed(1)}%` },
            ...(totalEarnings > 0 ? [{ icon: DollarSign, color: 'emerald', label: 'Total ganado', value: formatCurrency(totalEarnings, 'CLP') }] : []),
            { icon: Calendar,   color: 'amber',   label: 'Campañas activas',    value: String(activeCampaigns) },
          ].map(({ icon: Icon, color, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 text-${color}-600`} />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-400">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {([
          { id: 'overview',     label: 'Overview' },
          { id: 'plan',         label: 'Plan' },
          { id: 'campaigns',    label: `Campañas (${campaignInfluencers.length})` },
          { id: 'deliverables', label: `Deliverables (${deliverables.length})` },
          { id: 'history',      label: `Historial (${history.length})` },
          { id: 'documents',    label: 'Documentos' },
          { id: 'notes',        label: 'Notas' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            {influencer.bio && (
              <div className="card p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Bio</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{influencer.bio}</p>
              </div>
            )}

            {/* Platform metrics */}
            <div className="card p-5">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Métricas por plataforma</h3>
              {socialProfiles.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Sin redes sociales registradas</p>
              ) : (
                <div className="space-y-4">
                  {socialProfiles.map(sp => (
                    <div key={sp.id} className="flex items-start gap-4 p-4 rounded-xl bg-gray-50">
                      <div className="text-2xl flex-shrink-0">{PLATFORM_ICONS[sp.platform]}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-gray-900">
                            {sp.username ? `@${sp.username}` : (PLATFORM_LABELS[sp.platform] ?? sp.platform)}
                          </span>
                          <span className="text-xs text-gray-400">{PLATFORM_LABELS[sp.platform]}</span>
                          {sp.is_primary && <span className="badge badge-purple text-xs">Principal</span>}
                        </div>
                        <InstagramSyncHint profile={sp} className="-mt-1 mb-2" />
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: 'Seguidores',   value: hideUnconfirmedZero(sp) ? '—' : formatFollowers(sp.followers ?? 0) },
                            { label: 'Engagement',   value: `${(sp.engagement_rate ?? 0).toFixed(1)}%` },
                            { label: 'Avg likes',    value: formatFollowers(sp.avg_likes ?? 0) },
                            { label: 'Avg comments', value: formatFollowers(sp.avg_comments ?? 0) },
                          ].map(m => (
                            <div key={m.label}>
                              <div className="text-sm font-bold text-gray-900">{m.value}</div>
                              <div className="text-xs text-gray-400">{m.label}</div>
                            </div>
                          ))}
                        </div>
                        {(() => {
                          const pUrl = sp.profile_url || buildProfileUrl(sp.platform, sp.username)
                          return pUrl ? (
                            <a href={pUrl} target="_blank" rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs text-violet-600 hover:underline">
                              Ver perfil <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Rate cards */}
            <div className="card p-5">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Tarifas</h3>
              {rateCards.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Sin tarifas definidas</p>
              ) : (
                <div className="space-y-2.5">
                  {rateCards.map(rc => (
                    <div key={rc.id} className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-gray-700 capitalize">
                          {(rc.deliverable_type ?? rc.service_type ?? '').replace(/_/g, ' ')}
                        </p>
                        {rc.notes && <p className="text-xs text-gray-400">{rc.notes}</p>}
                      </div>
                      <span className="text-sm font-bold text-gray-900 whitespace-nowrap ml-2">
                        {formatCurrency(rc.base_rate, rc.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Location */}
            {influencer.address && (
              <div className="card p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Ubicación</h3>
                <AddressWithMap address={influencer.address} />
              </div>
            )}

            {/* Tags */}
            {(influencer.tags ?? []).length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Tags internos</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(influencer.tags ?? []).map(t => (
                    <span key={t} className="badge badge-gray text-xs">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Plan ── */}
      {tab === 'plan' && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Star className="h-4 w-4 fill-current" /></span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-gray-950">{influencer.is_pro ? 'SCENCE PRO' : 'PLAN GRATIS'}</h3>
                    {influencer.pro_source === 'paid' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700">PAGA</span>}
                    {influencer.pro_source === 'manual' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-violet-700">MANUAL</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {influencer.pro_source === 'paid' ? 'Suscripción activa por pago' : influencer.pro_source === 'manual' ? 'Acceso Pro otorgado manualmente' : 'Cuenta gratuita'}
                  </p>
                </div>
              </div>
              </div>
              {influencer.pro_source === 'paid' ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Suscripción activa
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleManualPro(influencer.pro_source !== 'manual')}
                  disabled={changingPro}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
                    influencer.pro_source === 'manual'
                      ? 'border border-red-200 text-red-600 hover:bg-red-50'
                      : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  )}
                >
                  {changingPro ? 'Actualizando…' : influencer.pro_source === 'manual' ? 'Desactivar Pro manual' : 'Activar Pro manual'}
                </button>
              )}
            </div>
          </div>

          {influencer.is_pro === true && (
            <ProSubscriptionSection influencerId={influencer.id} isPro={true} proSource={influencer.pro_source} />
          )}
        </div>
      )}

      {/* ── Documents ── */}
      {tab === 'documents' && <AdminInfluencerDocuments influencerId={influencer.id} />}

      {/* ── Campaigns ── */}
      {tab === 'campaigns' && (
        <div className="card overflow-x-auto">
          {campaignInfluencers.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Sin campañas asignadas</p>
            </div>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Campaña', 'Tipo', 'Plataformas', 'Fee', 'Fechas', 'Estado', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orderedCampaignInfluencers.map(ci => (
                  <tr key={ci.id} className={cn(
  'transition-colors',
  ci.campaign?.status === 'completed' || ci.campaign?.status === 'canceled'
    ? 'bg-gray-50/70 text-gray-400 opacity-60 hover:opacity-80'
    : 'hover:bg-gray-50/70'
)}>
                    <td className="px-4 py-3">
                      <Link href={`/admin-campaigns/${ci.campaign?.id}`}
                        className={cn(
  'text-sm font-semibold transition-colors',
  ci.campaign?.status === 'completed' || ci.campaign?.status === 'canceled'
    ? 'text-gray-400 hover:text-gray-600'
    : 'text-gray-900 hover:text-violet-700'
)}>
                        {ci.campaign?.name ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge badge-gray text-xs capitalize">
                        {(ci.campaign?.type ?? '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {(ci.campaign?.platforms ?? []).map(p => (
                          <span key={p} className="text-base">{PLATFORM_ICONS[p]}</span>
                        ))}
                      </div>
                    </td>
                    <td className={cn('px-4 py-3 text-sm font-bold', ci.campaign?.status === 'completed' || ci.campaign?.status === 'canceled' ? 'text-gray-400' : 'text-gray-900')}>
                      {ci.fee ? formatCurrency(ci.fee, 'CLP') : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {ci.campaign?.start_date && <div>{formatDate(ci.campaign.start_date, 'd MMM yy')}</div>}
                      {ci.campaign?.end_date && <div className="text-gray-300">→ {formatDate(ci.campaign.end_date, 'd MMM yy')}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${CAMPAIGN_STATUS_COLORS[ci.campaign?.status ?? ''] ?? 'badge-gray'} capitalize`}>
                        {ci.campaign?.status ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemoveFromCampaign(ci.id, ci.campaign?.id ?? '', ci.campaign?.name ?? '')}
                        disabled={removingCi === ci.id}
                        title="Sacar de esta campaña"
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      >
                        {removingCi === ci.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />
                        }
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Deliverables ── */}
      {tab === 'deliverables' && (
        <div className="card overflow-x-auto">
          {deliverables.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <FileText className="h-10 w-10 text-gray-200 mx-auto" />
              <p className="text-sm font-medium text-gray-500">Sin deliverables asignados</p>
              {(influencer.campaign_influencers ?? []).length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-400">
                    Esta influencer tiene {(influencer.campaign_influencers ?? []).length} campaña(s). Los deliverables se asignan desde cada campaña.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {(influencer.campaign_influencers ?? []).slice(0,3).map(ci => (
                      <Link key={ci.id}
                        href={`/admin-campaigns/${ci.campaign?.id}`}
                        className="text-xs px-3 py-1.5 bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition-colors font-medium">
                        + Agregar en {ci.campaign?.name ?? 'Campaña'}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Asigna esta influencer a una campaña para agregar deliverables.</p>
              )}
            </div>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Deliverable', 'Tipo', 'Plataforma', 'Campaña', 'Vencimiento', 'Estado', 'Link'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {deliverables.map(d => {
                  const s = DELIVERABLE_STATUS[d.status]
                  const StatusIcon = s?.icon ?? AlertCircle
                  return (
                    <tr key={d.id} className="hover:bg-gray-50/70 transition-colors">
                      {/* Simple: título truncado a 1 línea (antes se veía el
                          brief completo de la marca y rompía el layout de
                          la tabla) */}
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[220px] truncate" title={d.title}>{d.title}</td>
                      <td className="px-4 py-3">
                        <span className="badge badge-gray text-xs capitalize">{d.type ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-base">{d.platform ? PLATFORM_ICONS[d.platform] : '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{d.campaign?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {d.due_date ? formatDate(d.due_date, 'd MMM yy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${s?.cls ?? 'badge-gray'} flex items-center gap-1 w-fit`}>
                          <StatusIcon className="h-3 w-3" />
                          {s?.label ?? d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {d.content_url ? (
                          <a href={d.content_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-violet-600 hover:underline whitespace-nowrap">
                            Ver contenido →
                          </a>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Unified history ── */}
      {tab === 'history' && (
        <div className="card p-6">
          <div className="mb-5">
            <h3 className="font-bold text-gray-900">Historial de acciones</h3>
            <p className="mt-1 text-sm text-gray-400">Campañas, contenido, canjes, acciones y ventas ordenados desde lo más reciente.</p>
          </div>
          {history.length === 0 ? (
            <div className="py-12 text-center">
              <Clock className="mx-auto mb-3 h-10 w-10 text-gray-200" />
              <p className="text-sm text-gray-400">Todavía no hay acciones registradas.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {history.map(item => {
                const content = (
                  <div className="flex gap-3 rounded-xl px-3 py-3 hover:bg-gray-50">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-50 text-base">{item.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="truncate text-sm text-gray-500">{item.detail}</p>
                    </div>
                    <time className="flex-shrink-0 text-xs text-gray-400">{formatDate(item.date, 'd MMM yyyy')}</time>
                  </div>
                )
                return item.href ? <Link key={item.id} href={item.href}>{content}</Link> : <div key={item.id}>{content}</div>
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Notes ── */}
      {tab === 'notes' && (
        <NotesTab id={id} notes={influencer.notes ?? null} />
      )}
    </div>
  )
}
