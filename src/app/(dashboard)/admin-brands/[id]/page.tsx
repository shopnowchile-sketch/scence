'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Building2, Globe, Mail, Phone, Target, Users,
  FileText, Send, CheckCircle2, Ban, ExternalLink, Pencil, MapPin, Trash2, Instagram, Store, Link2,
  Search, X, Loader2, UserPlus, ImagePlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getPlanTier, PLAN_LIMITS, formatPriceCLP } from '@/lib/plan-limits'
import { BrandModal } from '@/components/brands/BrandModal'
import { BrandDocumentsAdmin } from '@/components/brands/BrandDocumentsAdmin'

type Campaign = {
  id: string
  name: string
  status: string
  budget_total: number | null
  currency: string | null
}

type Brand = {
  id: string
  name: string
  logo_url: string | null
  website: string | null
  instagram?: string | null
  industry: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  status?: string | null
  user_id?: string | null
  last_sign_in_at?: string | null
  campaigns?: Campaign[]
  org_plan?: string | null
  subscription_plan_override?: 'basic' | 'growth' | 'pro' | null
  direct_influencers?: Array<{ id: string; display_name: string; avatar_url: string | null }>
}

type BrandLocation = {
  id: string
  name: string
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  location_type: 'store' | 'online' | 'event' | 'restaurant' | 'home' | 'virtual' | 'other'
  website_url: string | null
  is_public: boolean
  notes: string | null
}

type BrandInfluencer = {
  id: string
  display_name: string
  avatar_url: string | null
  status: string
  campaign_name?: string
  /** 'direct' = agregada/asignada vía brand_influencers, sin pasar por campaña. */
  via?: 'direct'
}

type BrandMember = {
  id: string
  email: string
  role: string
  invited_at: string | null
  joined_at: string | null
  is_active: boolean
}

type PickerInfluencer = {
  id: string
  display_name: string
  avatar_url: string | null
  city?: string | null
  country?: string | null
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

function statusClass(status?: string | null) {
  if (status === 'approved') return 'badge-green'
  if (status === 'suspended') return 'badge-red'
  return 'badge-orange'
}

function money(value: number | null, currency?: string | null) {
  if (!value) return '—'
  return `${currency ?? 'CLP'} ${value.toLocaleString('es-CL')}`
}

const VALID_TABS = ['overview', 'campaigns', 'influencers', 'locations', 'plan', 'billing', 'documents', 'access', 'members', 'history'] as const
type Tab = typeof VALID_TABS[number]

export default function AdminBrandDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [logoSaving, setLogoSaving] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  // Soporta deep-link a un tab específico (?tab=influencers) — usado al
  // volver desde /admin-influencers tras asignar influencers a la marca.
  const initialTabParam = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    (VALID_TABS as readonly string[]).includes(initialTabParam ?? '') ? (initialTabParam as Tab) : 'overview'
  )
  const [influencers, setInfluencers] = useState<BrandInfluencer[]>([])
  const [loadingInf, setLoadingInf] = useState(false)
  const [showInfluencerPicker, setShowInfluencerPicker] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerResults, setPickerResults] = useState<PickerInfluencer[]>([])
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set())
  const [pickerLoading, setPickerLoading] = useState(false)
  const [assigningInfluencers, setAssigningInfluencers] = useState(false)
  const [invoiceCampaignId, setInvoiceCampaignId] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [planOverride, setPlanOverride] = useState<'' | 'basic' | 'growth' | 'pro'>('')
  const [savingPlan, setSavingPlan] = useState(false)
  const [locations, setLocations] = useState<BrandLocation[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [members, setMembers] = useState<BrandMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [resendingMemberId, setResendingMemberId] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [newMemberRole, setNewMemberRole] = useState<'member' | 'brand_manager' | 'finance'>('member')
  const [invitingMember, setInvitingMember] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [savingOwner, setSavingOwner] = useState(false)
  const [newLocation, setNewLocation] = useState({
    name: '',
    location_type: 'store' as 'store' | 'online',
    address: '',
    city: '',
    region: '',
    country: 'Chile',
    website_url: '',
    is_public: false,
    notes: '',
  })

  const campaigns = useMemo(() => brand?.campaigns ?? [], [brand?.campaigns])
  const activeCampaigns = useMemo(() => campaigns.filter(c => c.status === 'active'), [campaigns])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brands/${params.id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando marca')
      setBrand(json.data)
      setInvoiceEmail(json.data?.contact_email ?? '')
      setOwnerEmail(json.data?.contact_email ?? '')
      setPlanOverride(json.data?.subscription_plan_override ?? '')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  async function uploadLogo(file: File) {
    if (!brand) return
    if (!file.type.startsWith('image/')) return toast.error('Usa una imagen JPG, PNG o WebP.')
    if (file.size > 5 * 1024 * 1024) return toast.error('El logo no puede superar 5 MB.')
    setLogoSaving(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/brands/${brand.id}/logo`, { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo subir el logo')
      setBrand(previous => previous ? { ...previous, logo_url: json.logo_url } : previous)
      toast.success('Logo de marca actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir el logo')
    } finally {
      setLogoSaving(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const loadInfluencers = useCallback(async () => {
    if (!brand) return
    setLoadingInf(true)
    // La ficha de marca es su roster propio, no un historial de participantes
    // de campañas. Solo muestra relaciones explícitas en brand_influencers.
    setInfluencers((brand.direct_influencers ?? []).map(inf => ({
      id: inf.id,
      display_name: inf.display_name,
      avatar_url: inf.avatar_url,
      status: 'active',
      via: 'direct' as const,
    })))
    setLoadingInf(false)
  }, [brand])

  const loadMembers = useCallback(async () => {
    if (!brand) return
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}/members`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando usuarios')
      setMembers(json.data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingMembers(false)
    }
  }, [brand])

  async function resendMemberAccess(member: BrandMember) {
    if (!brand) return
    setResendingMemberId(member.id)
    try {
      // El owner usa el mismo flujo de invite/resend que ya existe para la
      // marca (crea el usuario si no existe, reenvía magic link). Los
      // miembros del equipo (brand_members) usan la ruta nueva /members.
      const res = member.role === 'owner'
        ? await fetch(`/api/brands/${brand.id}/invite`, { method: 'POST' })
        : await fetch(`/api/brands/${brand.id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member_id: member.id }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo reenviar el acceso')
      toast.success(json.message ?? 'Email reenviado')
      if (json.action_link && !json.email_sent) {
        await navigator.clipboard.writeText(json.action_link).catch(() => {})
        toast.info('Link copiado')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setResendingMemberId(null)
    }
  }

  async function removeMember(member: BrandMember) {
    if (!brand || member.role === 'owner') return
    if (!window.confirm(`¿Eliminar el acceso de ${member.email} a esta marca?`)) return
    setRemovingMemberId(member.id)
    try {
      const res = await fetch(`/api/brands/${brand.id}/members?member_id=${member.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo eliminar el acceso')
      setMembers(current => current.filter(item => item.id !== member.id))
      toast.success('Usuario desvinculado de la marca')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el acceso')
    } finally {
      setRemovingMemberId(null)
    }
  }

  async function saveOwner() {
    if (!brand || !ownerEmail.trim()) return
    setSavingOwner(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_email: ownerEmail.trim().toLowerCase() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo asignar el owner')
      setBrand(json.data)
      setOwnerEmail(json.data.contact_email ?? '')
      toast.success('Owner asignado y acceso enviado')
      await loadMembers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo asignar el owner')
    } finally {
      setSavingOwner(false)
    }
  }

  async function inviteMember() {
    if (!brand || !newMemberEmail.trim()) return
    setInvitingMember(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newMemberEmail, role: newMemberRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo invitar al usuario')
      setNewMemberEmail('')
      toast.success(json.data?.email_sent ? 'Invitación enviada por email' : 'Usuario agregado; el correo no pudo enviarse')
      await loadMembers()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setInvitingMember(false)
    }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'influencers') loadInfluencers() }, [tab, loadInfluencers])
  useEffect(() => { if (tab === 'locations') loadLocations() }, [tab, brand?.id])
  useEffect(() => { if (tab === 'members') loadMembers() }, [tab, loadMembers])

  useEffect(() => {
    if (!showInfluencerPicker) return

    let cancelled = false

    const timer = window.setTimeout(async () => {
      setPickerLoading(true)

      try {
        const query = new URLSearchParams({
          page: '1',
          limit: '50',
          is_active: 'true',
        })

        if (pickerSearch.trim()) {
          query.set('search', pickerSearch.trim())
        }

        const res = await fetch(`/api/influencers?${query}`)
        const json = await res.json().catch(() => ({}))

        if (!res.ok) {
          throw new Error(json.error ?? 'No se pudieron cargar las influencers')
        }

        if (!cancelled) {
          setPickerResults((json.data ?? []).map((inf: Record<string, unknown>) => ({
            id: String(inf.id),
            display_name: String(inf.display_name ?? 'Sin nombre'),
            avatar_url: typeof inf.avatar_url === 'string' ? inf.avatar_url : null,
            city: typeof inf.city === 'string' ? inf.city : null,
            country: typeof inf.country === 'string' ? inf.country : null,
          })))
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las influencers')
          setPickerResults([])
        }
      } finally {
        if (!cancelled) setPickerLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [showInfluencerPicker, pickerSearch])

  function togglePickerInfluencer(id: string) {
    const alreadyDirect = brand?.direct_influencers?.some(inf => inf.id === id)
    if (alreadyDirect) return

    setPickerSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assignInfluencersFromPicker() {
    if (!brand || pickerSelected.size === 0) return

    const selectedIds = Array.from(pickerSelected)
    setAssigningInfluencers(true)

    try {
      const res = await fetch(`/api/brands/${brand.id}/influencers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencer_ids: selectedIds }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json.error ?? 'No se pudieron agregar las influencers')
      }

      const added = pickerResults.filter(inf => pickerSelected.has(inf.id))

      setInfluencers(prev => {
        const seen = new Set(prev.map(inf => inf.id))
        return [
          ...prev,
          ...added
            .filter(inf => !seen.has(inf.id))
            .map(inf => ({
              id: inf.id,
              display_name: inf.display_name,
              avatar_url: inf.avatar_url,
              status: 'active',
              via: 'direct' as const,
            })),
        ]
      })

      setBrand(prev => {
        if (!prev) return prev

        const current = prev.direct_influencers ?? []
        const seen = new Set(current.map(inf => inf.id))

        return {
          ...prev,
          direct_influencers: [
            ...current,
            ...added
              .filter(inf => !seen.has(inf.id))
              .map(inf => ({
                id: inf.id,
                display_name: inf.display_name,
                avatar_url: inf.avatar_url,
              })),
          ],
        }
      })

      toast.success(`${selectedIds.length} influencer${selectedIds.length !== 1 ? 's' : ''} agregada${selectedIds.length !== 1 ? 's' : ''} a la marca`)
      setPickerSelected(new Set())
      setPickerSearch('')
      setShowInfluencerPicker(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron agregar las influencers')
    } finally {
      setAssigningInfluencers(false)
    }
  }

  async function createInvoice() {
    if (!brand) return
    if (!invoiceCampaignId) return toast.error('Selecciona una campaña')
    if (!invoiceAmount || Number(invoiceAmount) <= 0) return toast.error('Ingresa un monto')
    if (!invoiceEmail) return toast.error('Ingresa email de facturación')

    setCreatingInvoice(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id: brand.id,
          campaign_id: invoiceCampaignId,
          amount: Number(invoiceAmount),
          total_amount: Number(invoiceAmount),
          billing_email: invoiceEmail,
          client_email: invoiceEmail,
          currency: 'CLP',
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear la factura')

      toast.success('Factura creada')
      setInvoiceAmount('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreatingInvoice(false)
    }
  }


  async function loadLocations() {
    if (!brand) return
    setLoadingLocations(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}/locations`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando lugares')
      setLocations(json.data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingLocations(false)
    }
  }

  async function createLocation() {
    if (!brand) return
    if (!newLocation.name.trim()) return toast.error('Nombre requerido')

    const res = await fetch(`/api/brands/${brand.id}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLocation),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo crear lugar')

    setLocations(prev => [json.data, ...prev])
    setNewLocation({ name: '', location_type: 'store', address: '', city: '', region: '', country: 'Chile', website_url: '', is_public: false, notes: '' })
    toast.success('Lugar agregado')
  }

  async function toggleLocationPublic(location: BrandLocation) {
    if (!brand) return

    const res = await fetch(`/api/brands/${brand.id}/locations/${location.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !location.is_public }),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo actualizar')

    setLocations(prev => prev.map(l => l.id === location.id ? json.data : l))
  }

  async function deleteLocation(location: BrandLocation) {
    if (!brand) return
    if (!confirm(`¿Eliminar el lugar "${location.name}"?`)) return

    const res = await fetch(`/api/brands/${brand.id}/locations/${location.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo eliminar')

    setLocations(prev => prev.filter(l => l.id !== location.id))
    toast.success('Lugar eliminado')
  }

  async function savePlanOverride() {
    if (!brand) return

    setSavingPlan(true)

    try {
      const res = await fetch(`/api/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription_plan_override: planOverride || null,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json.error ?? 'No se pudo actualizar el plan')
      }

      setBrand(prev => prev ? {
        ...prev,
        subscription_plan_override: json.data.subscription_plan_override ?? null,
        org_plan: json.data.org_plan ?? prev.org_plan,
      } : prev)

      toast.success('Plan de la marca actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el plan')
    } finally {
      setSavingPlan(false)
    }
  }

  async function updateStatus(status: 'approved' | 'pending_approval' | 'suspended') {
    if (!brand) return

    const res = await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo actualizar')

    setBrand({ ...brand, status, subscription_plan_override: status === 'suspended' ? null : brand.subscription_plan_override })
    toast.success(status === 'approved' ? 'Marca aprobada' : status === 'suspended' ? 'Marca suspendida: deberá suscribirse para reactivar su acceso' : 'Marca pendiente')
  }

  async function deleteBrand() {
    if (!brand) return
    if (!confirm(`¿Eliminar la marca "${brand.name}"? Esto no eliminará las campañas asociadas.`)) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/brands/${brand.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Marca eliminada')
      router.push('/admin-brands')
    } catch {
      toast.error('Error al eliminar')
      setDeleting(false)
    }
  }

  async function removeDirectInfluencer(inf: BrandInfluencer) {
    if (!brand) return
    if (!confirm(`¿Quitar a "${inf.display_name}" de esta marca?`)) return

    const res = await fetch(`/api/brands/${brand.id}/influencers?influencer_id=${inf.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo quitar')

    setInfluencers(prev => prev.filter(i => i.id !== inf.id))
    toast.success('Influencer quitada de la marca')
  }

  async function invite() {
    if (!brand) return

    const res = await fetch(`/api/brands/${brand.id}/invite`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) return toast.error(json.error ?? 'No se pudo invitar')

    toast.success(json.message ?? 'Invitación enviada')
    if (json.action_link && !json.email_sent) {
      await navigator.clipboard.writeText(json.action_link).catch(() => {})
      toast.info('Link copiado')
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Cargando marca…</div>

  if (!brand) {
    return (
      <div className="p-8">
        <Link href="/admin-brands" className="text-sm text-violet-600 hover:underline">← Volver a marcas</Link>
        <p className="mt-6 text-gray-500">Marca no encontrada.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <button onClick={() => router.push('/admin-brands')} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-600">
        <ArrowLeft className="h-4 w-4" /> Volver a marcas
      </button>

      <div className="card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative shrink-0">
              {brand.logo_url ? (
                <img src={brand.logo_url} alt={`Logo de ${brand.name}`} className="h-24 w-24 rounded-2xl border border-gray-100 bg-white object-cover shadow-sm" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 text-3xl font-bold text-white shadow-sm">
                  {initials(brand.name)}
                </div>
              )}
              <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
                const file = event.target.files?.[0]
                if (file) void uploadLogo(file)
              }} />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoSaving}
                title={logoSaving ? 'Subiendo logo' : brand.logo_url ? 'Cambiar logo' : 'Subir logo'}
                aria-label={logoSaving ? 'Subiendo logo' : brand.logo_url ? 'Cambiar logo' : 'Subir logo'}
                className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-white text-violet-600 shadow-md hover:bg-violet-50 disabled:opacity-50"
              >
                {logoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              </button>
            </div>

            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-gray-900">{brand.name}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {brand.industry ?? 'Sin industria'} · {brand.user_id ? 'Portal habilitado' : 'Sin acceso al portal'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={brand.status ?? 'pending_approval'}
              onChange={event => updateStatus(event.target.value as 'approved' | 'pending_approval' | 'suspended')}
              aria-label="Estado de la marca"
              className={cn('rounded-lg border px-3 py-2 text-sm font-semibold outline-none', statusClass(brand.status))}
            >
              <option value="approved">Aprobada</option>
              <option value="pending_approval">Pendiente</option>
              <option value="suspended">Suspendida</option>
            </select>
            {brand.contact_email && (
              <button onClick={invite} title="Enviar acceso" aria-label="Enviar acceso" className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <Send className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setShowEditModal(true)} title="Editar marca" aria-label="Editar marca" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={deleteBrand} disabled={deleting} title="Eliminar marca" aria-label="Eliminar marca" className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {showEditModal && (
        <BrandModal
          editing={brand}
          onClose={() => setShowEditModal(false)}
          onSaved={() => load()}
        />
      )}

      {showInfluencerPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setShowInfluencerPicker(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="font-bold text-gray-900">Agregar influencers</h2>
                <p className="text-sm text-gray-500">Selecciona quiénes aparecerán en la base privada de {brand.name}.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInfluencerPicker(false)}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={pickerSearch}
                  onChange={event => setPickerSearch(event.target.value)}
                  placeholder="Buscar por nombre, Instagram o email"
                  className="input-base w-full pl-9"
                  autoFocus
                />
              </div>

              <div className="max-h-[420px] space-y-2 overflow-y-auto">
                {pickerLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Buscando influencers…
                  </div>
                ) : pickerResults.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-400">No se encontraron influencers.</p>
                ) : (
                  pickerResults.map(inf => {
                    const alreadyDirect = brand.direct_influencers?.some(item => item.id === inf.id)
                    const selected = pickerSelected.has(inf.id)

                    return (
                      <button
                        key={inf.id}
                        type="button"
                        disabled={alreadyDirect}
                        onClick={() => togglePickerInfluencer(inf.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                          alreadyDirect
                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-60'
                            : selected
                              ? 'border-violet-500 bg-violet-50'
                              : 'border-gray-200 hover:border-violet-300 hover:bg-violet-50/40'
                        )}
                      >
                        {inf.avatar_url ? (
                          <img src={inf.avatar_url} alt={inf.display_name} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 font-bold text-white">
                            {inf.display_name.charAt(0).toUpperCase()}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{inf.display_name}</p>
                          <p className="truncate text-xs text-gray-400">
                            {[inf.city, inf.country].filter(Boolean).join(', ') || 'Sin ubicación'}
                          </p>
                        </div>

                        <div className={cn(
                          'flex h-5 w-5 items-center justify-center rounded border text-xs',
                          alreadyDirect
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : selected
                              ? 'border-violet-600 bg-violet-600 text-white'
                              : 'border-gray-300 text-transparent'
                        )}>
                          ✓
                        </div>

                        {alreadyDirect && (
                          <span className="text-xs font-semibold text-emerald-600">Ya agregada</span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
              <p className="text-sm text-gray-500">
                {pickerSelected.size} seleccionada{pickerSelected.size !== 1 ? 's' : ''}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowInfluencerPicker(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={pickerSelected.size === 0 || assigningInfluencers}
                  onClick={assignInfluencersFromPicker}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assigningInfluencers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Agregar a la marca
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 divide-x divide-gray-100 rounded-xl border border-gray-100 bg-white">
        <div className="p-4">
          <p className="text-xl font-bold text-gray-900">{activeCampaigns.length}</p>
          <p className="text-xs text-gray-500">Activas</p>
        </div>
        <div className="p-4">
          <p className="text-xl font-bold text-gray-900">{campaigns.length}</p>
          <p className="text-xs text-gray-500">Campañas</p>
        </div>
        <div className="p-4">
          <p className="text-xl font-bold text-gray-900">{brand.direct_influencers?.length ?? 0}</p>
          <p className="text-xs text-gray-500">Roster propio</p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {[
            ['overview', 'Overview'],
            ['campaigns', 'Campañas'],
            ['influencers', 'Influencers'],
            ['locations', 'Lugares'],
            ['plan', 'Plan'],
            ['billing', 'Billing'],
            ['documents', 'Documentos'],
            ['access', 'Acceso'],
            ['members', 'Usuarios'],
            ['history', 'Historial'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              className={cn(
                'py-3 text-sm font-semibold border-b-2 whitespace-nowrap',
                tab === id ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-400 hover:text-gray-700'
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="card p-5 lg:col-span-2 space-y-4">
            <h2 className="font-bold text-gray-900">Información de la marca</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Contacto</p>
                <p className="font-medium text-gray-900">{brand.contact_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Email</p>
                {brand.contact_email ? <a className="text-violet-600 hover:underline" href={`mailto:${brand.contact_email}`}>{brand.contact_email}</a> : '—'}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Teléfono</p>
                <p>{brand.contact_phone ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Website</p>
                {brand.website ? (
                  <a className="inline-flex items-center gap-1 text-violet-600 hover:underline" href={brand.website} target="_blank" rel="noopener noreferrer">
                    {brand.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : '—'}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Instagram para etiquetar</p>
                {brand.instagram ? (
                  <a className="inline-flex items-center gap-1.5 font-medium text-fuchsia-600 hover:underline" href={`https://instagram.com/${brand.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">
                    <Instagram className="h-3.5 w-3.5" /> @{brand.instagram.replace(/^@/, '')} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : <span className="text-gray-300">—</span>}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Última conexión</p>
                <p className={brand.last_sign_in_at ? 'text-gray-900' : 'text-gray-300'}>
                  {brand.last_sign_in_at
                    ? new Date(brand.last_sign_in_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Sin acceso'}
                </p>
              </div>
            </div>

            {brand.notes && (
              <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
                {brand.notes}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-3">
            <h2 className="font-bold text-gray-900">Acciones rápidas</h2>
            <Link href="/admin-campaigns/new" className="block w-full py-2 text-center text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700">
              Crear campaña para marca
            </Link>
            <Link href="/admin-campaigns" className="block w-full py-2 text-center text-sm font-semibold bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100">
              Asignar / editar campañas
            </Link>
            <Link href="/admin-influencers" className="block w-full py-2 text-center text-sm font-semibold bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100">
              Buscar influencers
            </Link>
          </div>
        </div>
      )}

      {tab === 'documents' && <BrandDocumentsAdmin brandId={brand.id} />}

      {tab === 'campaigns' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="font-bold text-gray-900">Campañas de la marca</h2>
            <Link href="/admin-campaigns/new" className="text-sm font-semibold text-violet-600 hover:underline">Nueva campaña</Link>
          </div>

          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Campaña', 'Estado', 'Budget', 'Acciones'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.status}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{money(c.budget_total, c.currency)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin-campaigns/${c.id}`} className="text-sm text-violet-600 hover:underline">Abrir campaña</Link>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                    Sin campañas asociadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'influencers' && (
        <div className="card p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-gray-900">Influencers de esta marca</h2>
            <button
              type="button"
              onClick={() => {
                setPickerSelected(new Set())
                setPickerSearch('')
                setShowInfluencerPicker(true)
              }}
              className="flex items-center gap-1.5 text-sm font-semibold text-violet-600 hover:text-violet-700"
            >
              <UserPlus className="h-4 w-4" />
              Agregar influencers
            </button>
          </div>

          {loadingInf ? (
            <p className="text-sm text-gray-400">Cargando influencers…</p>
          ) : influencers.length === 0 ? (
            <p className="text-sm text-gray-400">Esta marca aún no tiene influencers agregadas a su roster propio.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {influencers.map(inf => (
                <div key={inf.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-violet-50">
                  <Link href={`/admin-influencers/${inf.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                    {inf.avatar_url ? (
                      <img src={inf.avatar_url} alt={inf.display_name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold">
                        {inf.display_name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{inf.display_name}</p>
                      {inf.via === 'direct' ? (
                        <span className="badge badge-blue text-[10px]">Agregada por la marca</span>
                      ) : (
                        <p className="text-xs text-gray-400 truncate">{inf.campaign_name}</p>
                      )}
                    </div>
                  </Link>
                  {inf.via === 'direct' && (
                    <button
                      type="button"
                      onClick={() => removeDirectInfluencer(inf)}
                      title="Quitar de la marca"
                      className="p-1.5 text-gray-300 hover:text-red-500 flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}



      {tab === 'locations' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="card space-y-4 p-5">
            <div>
              <h2 className="font-bold text-gray-900">Agregar punto de venta</h2>
              <p className="mt-1 text-sm text-gray-500">Registra una tienda física o el link de e-commerce de esta marca.</p>
            </div>
            <div className="space-y-3">
              <select value={newLocation.location_type} onChange={event => setNewLocation(value => ({ ...value, location_type: event.target.value as 'store' | 'online', is_public: event.target.value === 'online' ? true : value.is_public }))} className="input-base w-full">
                <option value="store">Punto de venta físico</option>
                <option value="online">E-commerce</option>
              </select>
              <input value={newLocation.name} onChange={event => setNewLocation(value => ({ ...value, name: event.target.value }))} placeholder={newLocation.location_type === 'online' ? 'Nombre del e-commerce' : 'Nombre del punto de venta'} className="input-base w-full" />
              <input type="url" value={newLocation.website_url} onChange={event => setNewLocation(value => ({ ...value, website_url: event.target.value }))} placeholder={newLocation.location_type === 'online' ? 'https://tienda.marca.cl' : 'Link del sitio o e-commerce (opcional)'} className="input-base w-full" />
              {newLocation.location_type === 'store' && (
                <>
                  <input value={newLocation.address} onChange={event => setNewLocation(value => ({ ...value, address: event.target.value }))} placeholder="Dirección" className="input-base w-full" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={newLocation.city} onChange={event => setNewLocation(value => ({ ...value, city: event.target.value }))} placeholder="Comuna / ciudad" className="input-base w-full" />
                    <input value={newLocation.region} onChange={event => setNewLocation(value => ({ ...value, region: event.target.value }))} placeholder="Región" className="input-base w-full" />
                  </div>
                </>
              )}
              <textarea value={newLocation.notes} onChange={event => setNewLocation(value => ({ ...value, notes: event.target.value }))} placeholder="Notas internas (opcional)" className="input-base min-h-[72px] w-full" />
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={newLocation.is_public} disabled={newLocation.location_type === 'online'} onChange={event => setNewLocation(value => ({ ...value, is_public: event.target.checked }))} />
                Visible para asignarlo a campañas
              </label>
              <button type="button" onClick={createLocation} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700">
                {newLocation.location_type === 'online' ? <Link2 className="h-4 w-4" /> : <Store className="h-4 w-4" />}
                Agregar
              </button>
            </div>
          </section>
          <section className="card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">Lugares y puntos de venta</h2>
                <p className="mt-1 text-sm text-gray-500">Disponibles para usar en campañas.</p>
              </div>
              <span className="text-sm text-gray-400">{locations.length} registrado{locations.length !== 1 ? 's' : ''}</span>
            </div>
            {loadingLocations ? <p className="text-sm text-gray-400">Cargando lugares…</p> : locations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
                <Store className="mx-auto mb-2 h-5 w-5 text-gray-300" />
                <p className="text-sm text-gray-400">Aún no hay puntos de venta ni e-commerce registrados.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {locations.map(location => {
                  const isOnline = location.location_type === 'online'
                  return (
                    <article key={location.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isOnline ? <Globe className="h-4 w-4 text-violet-600" /> : <MapPin className="h-4 w-4 text-violet-600" />}
                            <p className="truncate font-bold text-gray-900">{location.name}</p>
                          </div>
                          <p className="mt-2 text-sm text-gray-500">{isOnline ? 'E-commerce' : location.address || 'Sin dirección'}</p>
                          {!isOnline && (location.city || location.region) && <p className="mt-1 text-xs text-gray-400">{[location.city, location.region, location.country].filter(Boolean).join(', ')}</p>}
                        </div>
                        <span className={cn('badge text-xs font-bold', location.is_public ? 'badge-green' : 'badge-gray')}>{location.is_public ? 'Disponible' : 'Privado'}</span>
                      </div>
                      {location.website_url && (
                        <a href={location.website_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex max-w-full items-center gap-1.5 text-sm font-semibold text-violet-600 hover:underline">
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{location.website_url.replace(/^https?:\/\//, '')}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      )}
                      {location.notes && <p className="mt-3 rounded-lg bg-white p-2 text-xs text-gray-500">{location.notes}</p>}
                      <div className="mt-4 flex gap-2">
                        <button type="button" disabled={isOnline} onClick={() => toggleLocationPublic(location)} className="flex-1 rounded-lg bg-white py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">
                          {isOnline ? 'Disponible' : location.is_public ? 'Hacer privado' : 'Hacer público'}
                        </button>
                        <button type="button" onClick={() => deleteLocation(location)} aria-label={`Eliminar ${location.name}`} className="inline-flex items-center justify-center rounded-lg bg-red-50 px-3 py-2 text-red-600 hover:bg-red-100"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'plan' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5 space-y-5">
            <div>
              <h2 className="font-bold text-gray-900">Plan de la marca</h2>
              <p className="text-sm text-gray-500 mt-1">
                Define los permisos y límites internos. Una asignación manual habilita acceso comercial sin cobro ni suscripción.
              </p>
            </div>

            {(() => {
              const tier = getPlanTier(brand.org_plan)
              const info = PLAN_LIMITS[tier]

              return (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase">Plan efectivo actual</p>
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'badge text-xs font-bold',
                      tier === 'pro'
                        ? 'badge-green'
                        : tier === 'growth'
                          ? 'badge-blue'
                          : 'badge-gray'
                    )}>
                      {info.label}
                    </span>
                    <span className="text-sm text-gray-600">
                      {formatPriceCLP(info.price_monthly_clp)} CLP/mes
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {brand.subscription_plan_override
                      ? 'Acceso comercial asignado manualmente a esta marca.'
                      : 'Heredado desde la suscripción o configuración general.'}
                  </p>
                </div>
              )
            })()}

            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase">
                Asignación administrativa
              </span>
              <select
                value={planOverride}
                onChange={event => setPlanOverride(
                  event.target.value as '' | 'basic' | 'growth' | 'pro'
                )}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Heredar configuración general</option>
                <option value="basic">Basic</option>
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
              </select>
            </label>

            <button
              type="button"
              onClick={savePlanOverride}
              disabled={savingPlan}
              className="w-full py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60"
            >
              {savingPlan ? 'Guardando…' : 'Guardar plan'}
            </button>
          </div>

          <div className="card p-5 space-y-4">
            <h2 className="font-bold text-gray-900">Límites por plan</h2>

            {(['basic', 'growth', 'pro'] as const).map(tier => {
              const info = PLAN_LIMITS[tier]

              return (
                <div key={tier} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-gray-900">{info.label}</span>
                    <span className="text-xs text-gray-500">
                      {formatPriceCLP(info.price_monthly_clp)}/mes
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {info.max_active_campaigns >= 999
                      ? 'Campañas activas sin límite práctico'
                      : `${info.max_active_campaigns} campaña activa`}
                    {' · '}
                    {info.max_roster_influencers >= 999
                      ? 'Roster sin límite práctico'
                      : `${info.max_roster_influencers} influencers en roster`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5 space-y-4">
            <div>
              <h2 className="font-bold text-gray-900">Crear factura</h2>
              <p className="text-sm text-gray-500 mt-1">
                Emitir factura directamente para {brand.name}.
              </p>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Campaña</span>
                <select
                  value={invoiceCampaignId}
                  onChange={e => setInvoiceCampaignId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">Seleccionar campaña</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Monto CLP</span>
                <input
                  type="number"
                  min="0"
                  value={invoiceAmount}
                  onChange={e => setInvoiceAmount(e.target.value)}
                  placeholder="Ej: 490000"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase">Email facturación</span>
                <input
                  type="email"
                  value={invoiceEmail}
                  onChange={e => setInvoiceEmail(e.target.value)}
                  placeholder="facturacion@marca.cl"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>

              <button
                type="button"
                disabled={creatingInvoice}
                onClick={createInvoice}
                className="w-full py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
              >
                {creatingInvoice ? 'Creando factura…' : 'Crear factura'}
              </button>
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div>
              <h2 className="font-bold text-gray-900">Pagar influencers</h2>
              <p className="text-sm text-gray-500 mt-1">
                Revisar influencers relacionadas y pagos/canjes pendientes.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setTab('influencers')}
              className="block w-full py-2 text-center text-sm font-semibold bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
            >
              Ver influencers de esta marca
            </button>

            <Link href="/admin-payroll" className="block w-full py-2 text-center text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              Ir a payroll
            </Link>
          </div>
        </div>
      )}

      {tab === 'access' && (
        <div className="card p-5 space-y-4">
          <h2 className="font-bold text-gray-900">Acceso portal marca</h2>
          <p className="text-sm text-gray-500">
            Estado actual: <span className="font-semibold text-gray-900">{brand.user_id ? 'usuario vinculado' : 'sin usuario vinculado'}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            {brand.contact_email && (
              <button onClick={invite} className="px-3 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700">
                Enviar invitación
              </button>
            )}
            <button onClick={() => updateStatus('approved')} className="px-3 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">
              Aprobar acceso
            </button>
            <button onClick={() => updateStatus('suspended')} className="px-3 py-2 text-sm font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
              Suspender acceso
            </button>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="font-bold text-gray-900">Usuarios con acceso al portal</h2>
            <p className="text-sm text-gray-500 mt-1">El contacto principal es el owner. Los demás son miembros del equipo.</p>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-violet-950">Owner de la marca</p>
                <p className="text-xs text-violet-700">Tiene el acceso principal al portal.</p>
              </div>
              {brand.user_id && <span className="badge badge-purple">Owner activo</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={ownerEmail}
                onChange={event => setOwnerEmail(event.target.value)}
                placeholder="owner@empresa.com"
                className="input-base flex-1 bg-white"
              />
              <button
                type="button"
                onClick={saveOwner}
                disabled={savingOwner || !ownerEmail.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {savingOwner ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {brand.user_id ? 'Actualizar owner' : 'Asignar owner'}
              </button>
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Equipo adicional</p>
          <div className="flex flex-col sm:flex-row gap-2 rounded-xl bg-gray-50 border border-gray-100 p-3">
            <input type="email" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && inviteMember()} placeholder="email@empresa.com" className="input-base flex-1 bg-white" />
            <select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value as typeof newMemberRole)} className="input-base bg-white sm:w-44">
              <option value="member">Miembro</option>
              <option value="brand_manager">Brand manager</option>
              <option value="finance">Finanzas</option>
            </select>
            <button type="button" onClick={inviteMember} disabled={invitingMember || !newMemberEmail.trim()} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
              {invitingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Invitar usuario
            </button>
          </div>

          {loadingMembers ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-400">Sin usuarios registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase font-semibold border-b border-gray-100">
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Rol</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2 pr-4">Invitado</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className="border-b border-gray-50">
                      <td className="py-3 pr-4 font-medium text-gray-900">{m.email}</td>
                      <td className="py-3 pr-4 capitalize">
                        <span className={cn('badge', m.role === 'owner' ? 'badge-purple' : 'badge-gray')}>
                          {m.role === 'owner' ? 'Owner' : m.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        {!m.is_active
                          ? <span className="badge badge-red">Desactivado</span>
                          : m.joined_at
                            ? <span className="badge badge-green">Activo</span>
                            : <span className="badge badge-orange">Invitación pendiente</span>}
                      </td>
                      <td className="py-3 pr-4 text-gray-500">
                        {m.invited_at
                          ? new Date(m.invited_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          {m.is_active && (
                            <button
                              onClick={() => resendMemberAccess(m)}
                              disabled={resendingMemberId === m.id}
                              className="px-3 py-1.5 text-xs font-semibold text-violet-600 bg-violet-50 rounded-lg hover:bg-violet-100 disabled:opacity-50"
                            >
                              {resendingMemberId === m.id ? 'Enviando…' : 'Reenviar acceso'}
                            </button>
                          )}
                          {m.role !== 'owner' && (
                            <button
                              type="button"
                              onClick={() => removeMember(m)}
                              disabled={removingMemberId === m.id}
                              title="Desvincular usuario de esta marca"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {removingMemberId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card p-8 text-center">
          <FileText className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="font-bold text-gray-900">Historial</p>
          <p className="text-sm text-gray-400 mt-1">Aquí después podemos conectar historial comercial, facturación y actividad.</p>
        </div>
      )}
    </div>
  )
}
