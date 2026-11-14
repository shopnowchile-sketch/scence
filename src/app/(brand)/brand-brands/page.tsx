'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, Search } from 'lucide-react'
import { BrandModal } from '@/components/brands/BrandModal'
import { toast } from 'sonner'

interface BrandRow {
  id: string
  name: string
  logo_url: string | null
  industry: string | null
  status: string | null
  relationship: string
  campaigns: string[]
}

type Contact = { contact_name: string | null; contact_email: string | null; contact_phone: string | null }
type Collaborator = Contact & { brand: { id: string; name: string; instagram: string | null } }
const emptyContact: Contact = { contact_name: null, contact_email: null, contact_phone: null }
const contactFields = [
  { key: 'contact_name', label: 'Nombre', type: 'text' },
  { key: 'contact_email', label: 'Email', type: 'email' },
  { key: 'contact_phone', label: 'Teléfono', type: 'tel' },
] as const

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase()
}

function statusLabel(status: string | null) {
  if (status === 'approved') return 'Aprobada'
  if (status === 'suspended') return 'Suspendida'
  return 'Pendiente'
}

function statusClass(status: string | null) {
  if (status === 'approved') return 'badge-green'
  if (status === 'suspended') return 'badge-red'
  return 'badge-orange'
}

export default function BrandBrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const [portfolio, setPortfolio] = useState<Collaborator[] | null>(null)
  const [canManagePortfolio, setCanManagePortfolio] = useState(false)
  const [contactForm, setContactForm] = useState<(Contact & { id?: string; instagram: string }) | null>(null)
  const [savingContact, setSavingContact] = useState(false)

  const loadPortfolio = useCallback(async () => {
    try {
      const response = await fetch('/api/brand/collaborators')
      if (response.status === 403) return
      const json = await response.json()
      if (!response.ok) throw new Error(json.error)
      setPortfolio(json.data)
      setCanManagePortfolio(json.canManage)
    } catch {
      toast.error('No se pudo cargar la cartera')
    }
  }, [])

  async function saveContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contactForm || savingContact) return
    const { id, instagram, ...contact } = contactForm
    setSavingContact(true)
    try {
      const response = await fetch('/api/brand/collaborators', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { collaborator_brand_id: id, ...contact } : { instagram, ...contact }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error)
      setContactForm(null)
      toast.success('Contacto guardado')
      await loadPortfolio()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el contacto')
    } finally {
      setSavingContact(false)
    }
  }

  const load = useCallback(async (value = '') => {
    setLoading(true)

    try {
      const query = value
        ? `?search=${encodeURIComponent(value)}`
        : ''

      const response = await fetch(`/api/brand/brands${query}`)
      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error ?? 'No se pudieron cargar las marcas')
      }

      setBrands(json.data ?? [])
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar las marcas'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    loadPortfolio()
  }, [load, loadPortfolio])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Marcas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Marcas creadas por tu empresa y colaboradoras de tus campañas
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva marca
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />

            <input
              value={search}
              onChange={event => {
                const value = event.target.value
                setSearch(value)
                load(value)
              }}
              placeholder="Buscar marca"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">
            Cargando marcas…
          </div>
        ) : brands.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />

            <p className="font-medium text-gray-700">
              Aún no tienes marcas relacionadas
            </p>

            <p className="text-sm text-gray-400 mt-1">
              Las marcas que crees o agregues a tus campañas aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-5 py-3 font-medium">Marca</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Relación</th>
                  <th className="px-5 py-3 font-medium">Industria</th>
                  <th className="px-5 py-3 font-medium">Campañas</th>
                </tr>
              </thead>

              <tbody>
                {brands.map(brand => (
                  <tr
                    key={brand.id}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {brand.logo_url ? (
                          <Image
                            src={brand.logo_url}
                            alt={brand.name} width={36} height={36} className="h-9 w-9 rounded-lg object-cover border border-gray-100"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center text-xs font-bold">
                            {initials(brand.name)}
                          </div>
                        )}

                        <span className="font-medium text-gray-900">
                          {brand.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className={statusClass(brand.status)}>
                        {statusLabel(brand.status)}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-gray-600">
                      {brand.relationship}
                    </td>

                    <td className="px-5 py-4 text-gray-600">
                      {brand.industry || '—'}
                    </td>

                    <td className="px-5 py-4 text-gray-600">
                      {brand.campaigns?.length
                        ? brand.campaigns.join(', ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {portfolio && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">Cartera de colaboradoras</h2>
            {canManagePortfolio && (
              <button type="button" className="text-sm font-semibold text-violet-700"
                disabled={savingContact}
                onClick={() => setContactForm({ ...emptyContact, instagram: '' })}>
                Agregar colaboradora
              </button>
            )}
          </div>
          {contactForm && (
            <form onSubmit={saveContact} className="space-y-3 rounded-lg border border-gray-200 p-4">
              <fieldset disabled={savingContact} className="grid gap-3 sm:grid-cols-2">
                {!contactForm.id && (
                  <label className="grid gap-1 text-sm">
                    Instagram de la marca
                    <input required className="rounded-lg border border-gray-300 px-3 py-2"
                      value={contactForm.instagram}
                      onChange={event => setContactForm({ ...contactForm, instagram: event.target.value })} />
                  </label>
                )}
                {contactForm.id && (
                  <p className="text-sm font-semibold text-gray-900 sm:col-span-2">
                    {portfolio.find(row => row.brand.id === contactForm.id)?.brand.name}
                  </p>
                )}
                {contactFields.map(({ key, label, type }) => (
                  <label key={key} className="grid gap-1 text-sm">
                    {label}
                    <input type={type} className="rounded-lg border border-gray-300 px-3 py-2"
                      value={contactForm[key] ?? ''}
                      onChange={event => setContactForm({ ...contactForm, [key]: event.target.value })} />
                  </label>
                ))}
                <div className="flex gap-4">
                  <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Guardar</button>
                  <button type="button" className="text-sm text-gray-600" onClick={() => setContactForm(null)}>Cancelar</button>
                </div>
              </fieldset>
            </form>
          )}
          {portfolio.length === 0 ? (
            <p className="text-sm text-gray-500">Aún no tienes colaboradoras en tu cartera.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {portfolio.map(({ brand, contact_name, contact_email, contact_phone }) => (
                <li key={brand.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{brand.name} {brand.instagram}</p>
                    <p className="text-gray-600">{[contact_name, contact_email, contact_phone].filter(Boolean).join(' · ') || 'Sin contacto'}</p>
                  </div>
                  {canManagePortfolio && (
                    <button type="button" className="font-medium text-violet-700" disabled={savingContact}
                      onClick={() => setContactForm({ id: brand.id, instagram: '', contact_name, contact_email, contact_phone })}>
                      Editar contacto
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {showModal && (
        <BrandModal
          key="new-brand"
          editing={null}
          createEndpoint="/api/brand/brands"
          onClose={() => setShowModal(false)}
          onSaved={() => load(search)}
        />
      )}
    </div>
  )
}
