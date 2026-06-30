'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, Globe, Mail, Phone, Target, Users,
  FileText, Send, CheckCircle2, Ban, ExternalLink, Pencil, MapPin, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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
  industry: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  status?: string | null
  user_id?: string | null
  last_sign_in_at?: string | null
  campaigns?: Campaign[]
}

type BrandLocation = {
  id: string
  name: string
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  is_public: boolean
  notes: string | null
}

type BrandInfluencer = {
  id: string
  display_name: string
  avatar_url: string | null
  status: string
  campaign_name: string
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

function statusLabel(status?: string | null) {
  if (status === 'approved') return 'Aprobada'
  if (status === 'suspended') return 'Suspendida'
  return 'Pendiente'
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

export default function AdminBrandDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'campaigns' | 'influencers' | 'locations' | 'billing' | 'access' | 'history'>('overview')
  const [influencers, setInfluencers] = useState<BrandInfluencer[]>([])
  const [loadingInf, setLoadingInf] = useState(false)
  const [invoiceCampaignId, setInvoiceCampaignId] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [locations, setLocations] = useState<BrandLocation[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [newLocation, setNewLocation] = useState({
    name: '',
    address: '',
    city: '',
    region: '',
    country: 'Chile',
    is_public: false,
    notes: '',
  })

  const campaigns = brand?.campaigns ?? []
  const activeCampaigns = useMemo(() => campaigns.filter(c => c.status === 'active'), [campaigns])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brands/${params.id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error cargando marca')
      setBrand(json.data)
      setInvoiceEmail(json.data?.contact_email ?? '')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [params.id])

  const loadInfluencers = useCallback(async () => {
    if (!brand) return
    setLoadingInf(true)
    setInfluencers([])

    try {
      const results = await Promise.all(
        (brand.campaigns ?? []).map(c =>
          fetch(`/api/campaigns/${c.id}/influencers`)
            .then(r => r.json())
            .then(j => ({ campaign: c, influencers: j.data ?? [] }))
        )
      )

      const seen = new Set<string>()
      const flat: BrandInfluencer[] = []

      for (const result of results) {
        for (const ci of result.influencers) {
          const inf = ci.influencer
          if (!inf || seen.has(inf.id)) continue
          seen.add(inf.id)
          flat.push({
            id: inf.id,
            display_name: inf.display_name,
            avatar_url: inf.avatar_url,
            status: ci.status ?? ci.application_status ?? 'active',
            campaign_name: result.campaign.name,
          })
        }
      }

      setInfluencers(flat)
    } catch {
      toast.error('Error cargando influencers')
    } finally {
      setLoadingInf(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'influencers') loadInfluencers() }, [tab, loadInfluencers])
  useEffect(() => { if (tab === 'locations') loadLocations() }, [tab, brand?.id])


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
    setNewLocation({ name: '', address: '', city: '', region: '', country: 'Chile', is_public: false, notes: '' })
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

  async function updateStatus(status: 'approved' | 'pending_approval' | 'suspended') {
    if (!brand) return

    const res = await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(json.error ?? 'No se pudo actualizar')

    setBrand({ ...brand, status })
    toast.success(status === 'approved' ? 'Marca aprobada' : status === 'suspended' ? 'Marca suspendida' : 'Marca pendiente')
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
    <div className="space-y-6">
      <button onClick={() => router.push('/admin-brands')} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-600">
        <ArrowLeft className="h-4 w-4" /> Volver a marcas
      </button>

      <div className="card p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            {brand.logo_url ? (
              <img src={brand.logo_url} alt={brand.name} className="w-16 h-16 rounded-2xl object-contain border border-gray-100 p-1" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold text-lg">
                {initials(brand.name)}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900 truncate">{brand.name}</h1>
                <span className={cn('badge text-xs font-bold', statusClass(brand.status))}>
                  {statusLabel(brand.status)}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {brand.industry ?? 'Sin industria'} · {campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''} · {activeCampaigns.length} activa{activeCampaigns.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => updateStatus('approved')} className="px-3 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4 inline mr-1" /> Aprobar
            </button>
            <button onClick={() => updateStatus('pending_approval')} className="px-3 py-2 text-sm font-semibold bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100">
              Pendiente
            </button>
            <button onClick={() => updateStatus('suspended')} className="px-3 py-2 text-sm font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
              <Ban className="h-4 w-4 inline mr-1" /> Suspender
            </button>
            {brand.contact_email && (
              <button onClick={invite} className="px-3 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700">
                <Send className="h-4 w-4 inline mr-1" /> Invitar acceso
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <Target className="h-5 w-5 text-violet-600 mb-2" />
          <p className="text-2xl font-bold text-gray-900">{activeCampaigns.length}</p>
          <p className="text-sm text-gray-400">Campañas activas</p>
        </div>
        <div className="card p-4">
          <FileText className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-2xl font-bold text-gray-900">{campaigns.length}</p>
          <p className="text-sm text-gray-400">Total campañas</p>
        </div>
        <div className="card p-4">
          <Users className="h-5 w-5 text-emerald-600 mb-2" />
          <p className="text-2xl font-bold text-gray-900">{influencers.length || '—'}</p>
          <p className="text-sm text-gray-400">Influencers</p>
        </div>
        <div className="card p-4">
          <Building2 className="h-5 w-5 text-gray-600 mb-2" />
          <p className="text-sm font-bold text-gray-900">{brand.user_id ? 'Con acceso' : 'Sin acceso'}</p>
          <p className="text-sm text-gray-400">Portal marca</p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {[
            ['overview', 'Overview'],
            ['campaigns', 'Campañas'],
            ['influencers', 'Influencers'],
            ['locations', 'Lugares'],
            ['billing', 'Billing'],
            ['access', 'Acceso'],
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
            <h2 className="font-bold text-gray-900">Influencers relacionadas</h2>
            <Link href="/admin-influencers" className="text-sm font-semibold text-violet-600 hover:underline">Agregar desde influencers</Link>
          </div>

          {loadingInf ? (
            <p className="text-sm text-gray-400">Cargando influencers…</p>
          ) : influencers.length === 0 ? (
            <p className="text-sm text-gray-400">Sin influencers asociadas a campañas de esta marca.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {influencers.map(inf => (
                <Link key={inf.id} href={`/admin-influencers/${inf.id}`} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-violet-50">
                  {inf.avatar_url ? (
                    <img src={inf.avatar_url} alt={inf.display_name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold">
                      {inf.display_name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">{inf.display_name}</p>
                    <p className="text-xs text-gray-400 truncate">{inf.campaign_name}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}



      {tab === 'locations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="card p-5 space-y-4">
            <div>
              <h2 className="font-bold text-gray-900">Agregar lugar</h2>
              <p className="text-sm text-gray-500 mt-1">
                Lugares asociados a {brand.name}. Marca público solo si otras marcas pueden verlo.
              </p>
            </div>

            <div className="space-y-3">
              <input
                value={newLocation.name}
                onChange={e => setNewLocation(v => ({ ...v, name: e.target.value }))}
                placeholder="Nombre del lugar"
                className="input-base w-full"
              />

              <input
                value={newLocation.address}
                onChange={e => setNewLocation(v => ({ ...v, address: e.target.value }))}
                placeholder="Dirección"
                className="input-base w-full"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newLocation.city}
                  onChange={e => setNewLocation(v => ({ ...v, city: e.target.value }))}
                  placeholder="Ciudad"
                  className="input-base w-full"
                />
                <input
                  value={newLocation.region}
                  onChange={e => setNewLocation(v => ({ ...v, region: e.target.value }))}
                  placeholder="Región"
                  className="input-base w-full"
                />
              </div>

              <textarea
                value={newLocation.notes}
                onChange={e => setNewLocation(v => ({ ...v, notes: e.target.value }))}
                placeholder="Notas internas"
                className="input-base w-full min-h-[80px]"
              />

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newLocation.is_public}
                  onChange={e => setNewLocation(v => ({ ...v, is_public: e.target.checked }))}
                />
                Público para otras marcas
              </label>

              <button
                type="button"
                onClick={createLocation}
                className="w-full py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700"
              >
                Agregar lugar
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Lugares de la marca</h2>
              <span className="text-sm text-gray-400">{locations.length} lugar{locations.length !== 1 ? 'es' : ''}</span>
            </div>

            {loadingLocations ? (
              <p className="text-sm text-gray-400">Cargando lugares…</p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-gray-400">Aún no hay lugares asociados.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {locations.map(location => (
                  <div key={location.id} className="rounded-xl border border-gray-100 p-4 bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 truncate">{location.name}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {location.address || 'Sin dirección'}
                        </p>
                        {(location.city || location.region) && (
                          <p className="text-xs text-gray-400 mt-1">
                            {[location.city, location.region, location.country].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </div>

                      <span className={cn('badge text-xs font-bold', location.is_public ? 'badge-green' : 'badge-gray')}>
                        {location.is_public ? 'Público' : 'Privado'}
                      </span>
                    </div>

                    {location.notes && (
                      <p className="mt-3 text-xs text-gray-500 bg-white rounded-lg p-2">{location.notes}</p>
                    )}

                    <div className="flex gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => toggleLocationPublic(location)}
                        className="flex-1 py-2 text-xs font-semibold rounded-lg bg-white text-gray-700 hover:bg-gray-100"
                      >
                        {location.is_public ? 'Hacer privado' : 'Hacer público'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteLocation(location)}
                        className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
