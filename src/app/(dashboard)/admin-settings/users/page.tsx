'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Mail, Search, ShieldCheck, Users } from 'lucide-react'

type BrandUser = {
  id: string
  brand_id: string
  brand_name: string
  email: string
  role: 'owner' | 'brand_manager' | 'finance' | 'member'
  status: 'activo' | 'pendiente' | 'desactivado' | 'sin owner'
  invited_at: string | null
  member_id: string | null
}

const roleLabels: Record<BrandUser['role'], string> = {
  owner: 'Owner', brand_manager: 'Administrador', finance: 'Finanzas', member: 'Miembro',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<BrandUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [workingId, setWorkingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/brand-users')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUsers(json.data ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return users
    return users.filter(u => `${u.brand_name} ${u.email} ${roleLabels[u.role]}`.toLowerCase().includes(needle))
  }, [users, query])

  async function resend(user: BrandUser) {
    setWorkingId(`mail-${user.id}`)
    try {
      const res = user.role === 'owner'
        ? await fetch(`/api/brands/${user.brand_id}/invite`, { method: 'POST' })
        : await fetch(`/api/brands/${user.brand_id}/members`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: user.member_id }),
          })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`Acceso enviado a ${user.email}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo enviar el acceso') }
    finally { setWorkingId(null) }
  }

  async function changeRole(user: BrandUser, role: BrandUser['role']) {
    if (user.role === 'owner' || role === 'owner' || !user.member_id) return
    setWorkingId(`role-${user.id}`)
    try {
      const res = await fetch(`/api/brands/${user.brand_id}/members`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: user.member_id, role }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUsers(current => current.map(item => item.id === user.id ? { ...item, role } : item))
      toast.success('Rol actualizado')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el rol') }
    finally { setWorkingId(null) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Users className="h-6 w-6 text-violet-600" /> Usuarios de marcas</h1>
        <p className="mt-1 text-sm text-gray-500">Administra owners y equipos de todas las marcas desde un solo lugar.</p>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar marca, email o rol" className="input-base w-full pl-9" /></div>
          <span className="text-sm text-gray-500">{filtered.length} usuarios</span>
        </div>
        {loading ? <div className="h-48 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-5 py-3">Marca</th><th className="px-5 py-3">Usuario</th><th className="px-5 py-3">Rol</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map(user => <tr key={user.id} className="hover:bg-gray-50/70"><td className="px-5 py-4"><Link className="font-semibold text-gray-900 hover:text-violet-700" href={`/admin-brands/${user.brand_id}`}>{user.brand_name}</Link></td><td className="px-5 py-4 text-gray-700">{user.email || <span className="text-red-500">Sin email</span>}</td><td className="px-5 py-4">{user.role === 'owner' ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"><ShieldCheck className="h-3.5 w-3.5" /> Owner</span> : <select value={user.role} disabled={workingId === `role-${user.id}`} onChange={e => void changeRole(user, e.target.value as BrandUser['role'])} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"><option value="brand_manager">Administrador</option><option value="finance">Finanzas</option><option value="member">Miembro</option></select>}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === 'activo' ? 'bg-emerald-50 text-emerald-700' : user.status === 'pendiente' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{user.status}</span></td><td className="px-5 py-4 text-right"><button disabled={!user.email || workingId === `mail-${user.id}`} onClick={() => void resend(user)} title="Enviar login por email" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-40">{workingId === `mail-${user.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}</button></td></tr>)}</tbody></table>{!filtered.length && <div className="py-12 text-center text-sm text-gray-500">No encontramos usuarios.</div>}</div>
        )}
      </div>
    </div>
  )
}
