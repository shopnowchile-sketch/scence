'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Search, Users, UserCheck, UserX, RefreshCw, ShieldCheck } from 'lucide-react'

type OrganizationMember = {
  id: string
  user_id: string
  name: string | null
  email: string | null
  role: string
  is_owner: boolean
  is_active: boolean
  invited_at: string | null
  joined_at: string | null
  created_at: string | null
  account_created_at: string | null
}

type DirectoryResponse = {
  organization: { id: string; name: string; slug: string }
  data: OrganizationMember[]
  totals: { members: number; active: number; inactive: number }
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  agency_manager: 'Agency Manager',
  brand_manager: 'Brand Manager',
  finance: 'Finanzas',
  influencer: 'Influencer',
  member: 'Miembro',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">{label}</p>
        <Icon className="h-4 w-4 text-violet-500" />
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
    </div>
  )
}

export default function SettingsUsersPage() {
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/organization-members', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || 'No se pudo cargar el directorio')
      setDirectory(json as DirectoryResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error al cargar los miembros')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredMembers = useMemo(() => {
    const members = directory?.data ?? []
    const normalizedSearch = search.trim().toLocaleLowerCase('es-CL')
    return members.filter(member => {
      if (status === 'active' && !member.is_active) return false
      if (status === 'inactive' && member.is_active) return false
      if (!normalizedSearch) return true
      return [member.name, member.email, ROLE_LABELS[member.role] ?? member.role]
        .some(value => value?.toLocaleLowerCase('es-CL').includes(normalizedSearch))
    })
  }, [directory, search, status])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-600">
            <ShieldCheck className="h-4 w-4" /> Administración SCENCE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Usuarios de la organización</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Directorio de las cuentas vinculadas a la organización de SCENCE. Esta vista es de solo lectura.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => void load(true)} className="font-semibold underline underline-offset-2">Reintentar</button>
        </div>
      )}

      {directory && (
        <div className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
          <div className="rounded-xl bg-white p-2 text-violet-600"><Building2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{directory.organization.name}</p>
            <p className="mt-0.5 break-all text-xs text-gray-500">Organización canónica · {directory.organization.slug}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total de miembros" value={directory?.totals.members ?? 0} icon={Users} />
        <StatCard label="Membresías activas" value={directory?.totals.active ?? 0} icon={UserCheck} />
        <StatCard label="Membresías inactivas" value={directory?.totals.inactive ?? 0} icon={UserX} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Miembros</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {loading ? 'Cargando directorio…' : `${filteredMembers.length} de ${directory?.data.length ?? 0} registros`}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar nombre, email o rol"
                aria-label="Buscar miembros"
                className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-violet-400 sm:w-64"
              />
            </label>
            <select
              value={status}
              onChange={event => setStatus(event.target.value as typeof status)}
              aria-label="Filtrar por estado"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </div>
        </div>

        {loading && !directory ? (
          <div className="space-y-3 p-5" aria-label="Cargando miembros">
            {[0, 1, 2, 3].map(item => <div key={item} className="h-12 animate-pulse rounded-lg bg-gray-50" />)}
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">{error ? 'No se pudo cargar el directorio' : 'No hay miembros para mostrar'}</p>
            <p className="mt-1 text-xs text-gray-400">{error ? 'Verifica tu acceso o vuelve a intentarlo.' : 'Prueba con otro filtro de búsqueda.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 text-left">
                  {['Usuario', 'Rol en SCENCE', 'Estado', 'Ingreso', 'Cuenta creada'].map(heading => (
                    <th key={heading} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredMembers.map(member => (
                  <tr key={member.id} className="transition hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{member.name || 'Sin nombre'}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{member.email || 'Email no disponible'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {member.is_owner ? 'Owner' : ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${member.is_active ? 'text-emerald-700' : 'text-gray-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${member.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        {member.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(member.joined_at || member.invited_at)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(member.account_created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-gray-400">Por seguridad, este panel no permite invitar, editar roles ni activar o desactivar cuentas.</p>
    </div>
  )
}
