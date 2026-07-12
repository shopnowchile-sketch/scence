'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Search } from 'lucide-react'
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
  }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Marcas
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Marcas creadas por tu empresa y colaboradoras de tus campañas
        </p>
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
                          <img
                            src={brand.logo_url}
                            alt={brand.name}
                            className="h-9 w-9 rounded-lg object-cover border border-gray-100"
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
    </div>
  )
}
