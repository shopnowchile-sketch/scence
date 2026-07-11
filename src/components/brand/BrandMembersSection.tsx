'use client'

/**
 * BrandMembersSection — Usuarios con acceso al portal de marca.
 * Usado en /brand-settings/users.
 * Fetch propio de /api/brand/members.
 */

import { useEffect, useState, useCallback } from 'react'
import { Users, Plus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface BrandMember {
  id:          string
  email:       string
  role:        'owner' | 'brand_manager' | 'finance' | 'member'
  invited_at:  string
  joined_at:   string | null
  is_active:   boolean
}

const ROLE_LABELS: Record<BrandMember['role'], string> = {
  owner:         'Owner',
  brand_manager: 'Brand manager',
  finance:       'Finanzas',
  member:        'Miembro',
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
      <Icon className="h-3 w-3" /> {label}
    </p>
  )
}

export function BrandMembersSection() {
  const [members,  setMembers]  = useState<BrandMember[]>([])
  const [loading,  setLoading]  = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newRole,  setNewRole]  = useState<'brand_manager' | 'finance' | 'member'>('member')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/brand/members')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers(json.data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleInvite() {
    if (!newEmail) return
    setInviting(true)
    try {
      const res  = await fetch('/api/brand/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers(prev => [json.data, ...prev])
      setNewEmail('')

      if (json.data.email_sent) {
        toast.success('Invitación enviada por email')
      } else {
        toast.warning('La invitación quedó pendiente, pero el email no pudo enviarse')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('¿Desactivar el acceso de este usuario?')) return
    const res = await fetch(`/api/brand/members?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, is_active: false } : m))
      toast.success('Acceso desactivado')
    } else {
      toast.error('Error al desactivar')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[20vh]">
      <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <SectionTitle icon={Users} label="Usuarios con acceso" />
      <p className="text-xs text-gray-400">Invita a tu equipo a acceder al portal de tu marca.</p>

      {/* Invitar nuevo */}
      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          placeholder="email@equipo.com"
          className="input-base flex-1"
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
        />
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as 'brand_manager' | 'finance' | 'member')}
          className="input-base w-36"
        >
          <option value="member">Miembro</option>
          <option value="brand_manager">Brand manager</option>
          <option value="finance">Finanzas</option>
        </select>
        <button
          onClick={handleInvite}
          disabled={inviting || !newEmail}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-colors flex-shrink-0"
        >
          {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Invitar
        </button>
      </div>

      {/* Lista */}
      {members.length === 0 ? (
        <p className="text-xs text-gray-300 text-center py-4">Sin usuarios adicionales aún.</p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div
              key={m.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl border',
                m.is_active ? 'border-gray-100 bg-gray-50/50' : 'border-gray-100 bg-gray-50 opacity-50',
              )}
            >
              <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-[10px] font-bold text-violet-600 flex-shrink-0">
                {m.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{m.email}</p>
                <p className="text-[10px] text-gray-400">
                  {m.joined_at ? '✓ Activo' : '⏳ Invitación pendiente'} · {ROLE_LABELS[m.role] ?? m.role}
                </p>
              </div>
              {m.is_active && m.role !== 'owner' && (
                <button
                  onClick={() => handleRemove(m.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                  title="Desactivar acceso"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {!m.is_active && (
                <span className="text-[10px] text-gray-400 font-medium">Desactivado</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
